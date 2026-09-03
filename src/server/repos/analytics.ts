import { and, eq, inArray, sql } from "drizzle-orm";

import {
  buildAnalyticsSnapshot,
  buildCompanyConversion,
  type AnalyticsFacts,
  type AnalyticsSnapshot,
  type CompanyConversionStats,
} from "../../domain/analytics";
import { isInteractionChannel } from "../../domain/interaction";
import type { AppDatabase } from "../db/client";
import {
  activityEvent,
  application,
  contact,
  interaction,
  interview,
  opportunity,
  referralRequest,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { getCompany } from "./companies";

export type { AnalyticsSnapshot, CompanyConversionStats };

function loadAnalyticsFacts(
  database: AppDatabase,
  tenant: TenantContext,
): AnalyticsFacts {
  const opportunities = database
    .select({
      id: opportunity.id,
      bucket: opportunity.bucket,
    })
    .from(opportunity)
    .where(eq(opportunity.workspaceId, tenant.workspaceId))
    .all();

  const applications = database
    .select({
      id: application.id,
      opportunityId: application.opportunityId,
      stage: application.stage,
    })
    .from(application)
    .where(eq(application.workspaceId, tenant.workspaceId))
    .all();

  const referrals = database
    .select({
      id: referralRequest.id,
      opportunityId: referralRequest.opportunityId,
      stage: referralRequest.stage,
      channel: referralRequest.channel,
    })
    .from(referralRequest)
    .where(eq(referralRequest.workspaceId, tenant.workspaceId))
    .all();

  const interactionRows = database
    .select({
      id: interaction.id,
      channel: interaction.channel,
      direction: interaction.direction,
    })
    .from(interaction)
    .where(eq(interaction.workspaceId, tenant.workspaceId))
    .all();

  const ownedInteractionIds = new Set(interactionRows.map((row) => row.id));
  const interactionEvents = database
    .select({
      kind: activityEvent.kind,
      entityId: activityEvent.entityId,
      payload: activityEvent.payloadJson,
    })
    .from(activityEvent)
    .where(
      and(
        eq(activityEvent.workspaceId, tenant.workspaceId),
        inArray(activityEvent.kind, [
          "INTERACTION_SENT",
          "INTERACTION_REPLIED",
        ]),
      ),
    )
    .all();

  const interactionsFromEvents = interactionEvents.flatMap((event) => {
    if (!ownedInteractionIds.has(event.entityId)) {
      return [];
    }
    const channel = event.payload.channel;
    if (!isInteractionChannel(channel)) {
      return [];
    }
    return [
      {
        channel,
        direction:
          event.kind === "INTERACTION_SENT"
            ? ("outbound" as const)
            : ("inbound" as const),
      },
    ];
  });

  const interviews = database
    .select({ opportunityId: interview.opportunityId })
    .from(interview)
    .where(eq(interview.workspaceId, tenant.workspaceId))
    .all();

  return {
    opportunities,
    applications,
    referrals,
    interactions:
      interactionsFromEvents.length > 0
        ? interactionsFromEvents
        : interactionRows.map((row) => ({
            channel: row.channel,
            direction: row.direction,
          })),
    interviews,
  };
}

export function getAnalyticsSnapshot(
  database: AppDatabase,
  tenant: TenantContext,
): AnalyticsSnapshot {
  return buildAnalyticsSnapshot(loadAnalyticsFacts(database, tenant));
}

export function getCompanyConversionStats(
  database: AppDatabase,
  tenant: TenantContext,
  companyId: string,
): CompanyConversionStats | undefined {
  if (!getCompany(database, tenant, companyId)) {
    return undefined;
  }

  const opportunities = database
    .select({
      id: opportunity.id,
      bucket: opportunity.bucket,
    })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.companyId, companyId),
      ),
    )
    .all();
  const opportunityIds = opportunities.map((row) => row.id);

  const applications =
    opportunityIds.length === 0
      ? []
      : database
          .select({ id: application.id })
          .from(application)
          .where(
            and(
              eq(application.workspaceId, tenant.workspaceId),
              inArray(application.opportunityId, opportunityIds),
            ),
          )
          .all();

  const contacts = database
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.companyId, companyId),
      ),
    )
    .all();

  const referrals = database
    .select({
      id: referralRequest.id,
      stage: referralRequest.stage,
    })
    .from(referralRequest)
    .leftJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, referralRequest.workspaceId),
        eq(opportunity.id, referralRequest.opportunityId),
      ),
    )
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, referralRequest.workspaceId),
        eq(contact.id, referralRequest.contactId),
      ),
    )
    .where(
      and(
        eq(referralRequest.workspaceId, tenant.workspaceId),
        sql`coalesce(${opportunity.companyId}, ${contact.companyId}) = ${companyId}`,
      ),
    )
    .all();

  const interviews =
    opportunityIds.length === 0
      ? []
      : database
          .select({ id: interview.id })
          .from(interview)
          .where(
            and(
              eq(interview.workspaceId, tenant.workspaceId),
              inArray(interview.opportunityId, opportunityIds),
            ),
          )
          .all();

  return buildCompanyConversion({
    opportunities,
    applications,
    contacts,
    referrals,
    interviews,
  });
}
