import { and, desc, eq, inArray } from "drizzle-orm";

import {
  activityCalendarDate,
  formatActivityHeadline,
  isValidActivityDay,
} from "../../domain/activity";
import type { AppDatabase } from "../db/client";
import {
  activityEvent,
  application,
  company,
  contact,
  opportunity,
  referralRequest,
  task,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type ActivityEventRow = typeof activityEvent.$inferSelect;

export type ActivityFeedItem = {
  id: string;
  at: Date;
  kind: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  headline: string;
  day: string;
};

export type ActivityListFilter = {
  timeZone: string;
  on?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function collectIds(events: ActivityEventRow[]) {
  const ids = {
    company: new Set<string>(),
    contact: new Set<string>(),
    opportunity: new Set<string>(),
    application: new Set<string>(),
    referral: new Set<string>(),
    task: new Set<string>(),
  };
  for (const event of events) {
    if (event.entityType === "company") ids.company.add(event.entityId);
    if (event.entityType === "contact") ids.contact.add(event.entityId);
    if (event.entityType === "opportunity") ids.opportunity.add(event.entityId);
    if (event.entityType === "application") ids.application.add(event.entityId);
    if (
      event.entityType === "referral" ||
      event.entityType === "referral_request"
    ) {
      ids.referral.add(event.entityId);
    }
    if (event.entityType === "task") ids.task.add(event.entityId);
    const payload = event.payloadJson;
    const companyId = payloadString(payload, "companyId");
    const contactId = payloadString(payload, "contactId");
    const opportunityId = payloadString(payload, "opportunityId");
    const referralId = payloadString(payload, "referralId");
    if (companyId) ids.company.add(companyId);
    if (contactId) ids.contact.add(contactId);
    if (opportunityId) ids.opportunity.add(opportunityId);
    if (referralId) ids.referral.add(referralId);
  }
  return ids;
}

function loadLabels(
  database: AppDatabase,
  tenant: TenantContext,
  events: ActivityEventRow[],
): Map<string, string> {
  const ids = collectIds(events);
  const labels = new Map<string, string>();

  function put(type: string, id: string, label: string) {
    labels.set(`${type}:${id}`, label);
  }

  if (ids.company.size > 0) {
    for (const row of database
      .select({ id: company.id, name: company.name })
      .from(company)
      .where(
        and(
          eq(company.workspaceId, tenant.workspaceId),
          inArray(company.id, [...ids.company]),
        ),
      )
      .all()) {
      put("company", row.id, row.name);
    }
  }
  if (ids.contact.size > 0) {
    for (const row of database
      .select({ id: contact.id, name: contact.name })
      .from(contact)
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          inArray(contact.id, [...ids.contact]),
        ),
      )
      .all()) {
      put("contact", row.id, row.name);
    }
  }
  if (ids.opportunity.size > 0) {
    for (const row of database
      .select({
        id: opportunity.id,
        role: opportunity.role,
        companyName: company.name,
      })
      .from(opportunity)
      .innerJoin(
        company,
        and(
          eq(company.workspaceId, opportunity.workspaceId),
          eq(company.id, opportunity.companyId),
        ),
      )
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          inArray(opportunity.id, [...ids.opportunity]),
        ),
      )
      .all()) {
      put("opportunity", row.id, `${row.companyName} ${row.role}`);
    }
  }
  if (ids.application.size > 0) {
    for (const row of database
      .select({
        id: application.id,
        role: opportunity.role,
        companyName: company.name,
      })
      .from(application)
      .innerJoin(
        opportunity,
        and(
          eq(opportunity.workspaceId, application.workspaceId),
          eq(opportunity.id, application.opportunityId),
        ),
      )
      .innerJoin(
        company,
        and(
          eq(company.workspaceId, opportunity.workspaceId),
          eq(company.id, opportunity.companyId),
        ),
      )
      .where(
        and(
          eq(application.workspaceId, tenant.workspaceId),
          inArray(application.id, [...ids.application]),
        ),
      )
      .all()) {
      put("application", row.id, `${row.companyName} ${row.role}`);
    }
  }
  if (ids.referral.size > 0) {
    for (const row of database
      .select({
        id: referralRequest.id,
        contactName: contact.name,
      })
      .from(referralRequest)
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
          inArray(referralRequest.id, [...ids.referral]),
        ),
      )
      .all()) {
      put("referral", row.id, row.contactName);
      put("referral_request", row.id, row.contactName);
    }
  }
  if (ids.task.size > 0) {
    for (const row of database
      .select({ id: task.id, title: task.title })
      .from(task)
      .where(
        and(
          eq(task.workspaceId, tenant.workspaceId),
          inArray(task.id, [...ids.task]),
        ),
      )
      .all()) {
      put("task", row.id, row.title);
    }
  }

  return labels;
}

function eventLabel(
  event: ActivityEventRow,
  labels: Map<string, string>,
): string | null {
  const payload = event.payloadJson;
  if (event.entityType === "interaction") {
    const contactId = payloadString(payload, "contactId");
    if (contactId) {
      return labels.get(`contact:${contactId}`) ?? null;
    }
  }
  if (event.entityType === "tag") {
    return payloadString(payload, "label");
  }
  return labels.get(`${event.entityType}:${event.entityId}`) ?? null;
}

function matchesEntity(
  event: ActivityEventRow,
  entityType: string,
  entityId: string,
) {
  if (event.entityType === entityType && event.entityId === entityId) {
    return true;
  }
  const payload = event.payloadJson;
  return (
    payloadString(payload, "companyId") === entityId ||
    payloadString(payload, "contactId") === entityId ||
    payloadString(payload, "opportunityId") === entityId ||
    payloadString(payload, "referralId") === entityId
  );
}

export function listActivity(
  database: AppDatabase,
  tenant: TenantContext,
  filter: ActivityListFilter,
): ActivityFeedItem[] {
  const rows = database
    .select()
    .from(activityEvent)
    .where(eq(activityEvent.workspaceId, tenant.workspaceId))
    .orderBy(desc(activityEvent.at), desc(activityEvent.id))
    .all();

  const scoped = rows.filter((event) => {
    if (filter.entityType && filter.entityId) {
      if (!matchesEntity(event, filter.entityType, filter.entityId)) {
        return false;
      }
    }
    if (filter.on) {
      if (!isValidActivityDay(filter.on)) {
        return false;
      }
      if (activityCalendarDate(event.at, filter.timeZone) !== filter.on) {
        return false;
      }
    }
    return true;
  });

  const labels = loadLabels(database, tenant, scoped);
  return scoped.map((event) => ({
    id: event.id,
    at: event.at,
    kind: event.kind,
    entityType: event.entityType,
    entityId: event.entityId,
    payload: event.payloadJson,
    headline: formatActivityHeadline({
      kind: event.kind,
      entityLabel: eventLabel(event, labels),
      payload: event.payloadJson,
    }),
    day: activityCalendarDate(event.at, filter.timeZone),
  }));
}

export function parseActivityListFilter(
  searchParams: URLSearchParams,
  timeZone: string,
): ActivityListFilter {
  const on = searchParams.get("on");
  const entityType = searchParams.get("entityType");
  const entityId = searchParams.get("entityId");
  return {
    timeZone,
    on: on && isValidActivityDay(on) ? on : null,
    entityType: entityType && entityType.length > 0 ? entityType : null,
    entityId: entityId && entityId.length > 0 ? entityId : null,
  };
}
