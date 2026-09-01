import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import {
  isInteractionChannel,
  type InteractionChannel,
} from "../../domain/interaction";
import {
  DEFAULT_REFERRAL_STAGE,
  ReferralStageTransitionError,
  isReferralListPreset,
  isReferralStage,
  shiftCalendarDate,
  transitionReferralStage,
  type ReferralListPreset,
  type ReferralStage,
} from "../../domain/referral";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  application,
  company,
  contact,
  opportunity,
  referralRequest,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type Referral = typeof referralRequest.$inferSelect;
export type ReferralListItem = Referral & {
  contactName: string;
  companyName: string | null;
  role: string | null;
  hasSubmittedApplication: boolean;
};

export type ReferralListFilter = {
  asOfOn: string;
  preset?: ReferralListPreset;
  stage?: ReferralStage;
  contactId?: string;
  opportunityId?: string;
};

export type CreateReferralInput = {
  id?: string;
  contactId: string;
  opportunityId?: string | null;
  requestedOn?: string | null;
  channel: InteractionChannel;
  resumeShared?: boolean;
  jobIdShared?: boolean;
  jobUrlShared?: boolean;
  stage?: ReferralStage;
  followUpOn?: string | null;
  receivedOn?: string | null;
  confirmation?: string | null;
  nextAction?: string | null;
  notes?: string | null;
  todayOn?: string;
  now?: Date;
};

export type UpdateReferralInput = Partial<
  Omit<CreateReferralInput, "id" | "now" | "todayOn">
> & { todayOn?: string; now?: Date };

export class ReferralInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralInputError";
  }
}

const opportunityCompany = alias(company, "opportunity_company");
const contactCompany = alias(company, "contact_company");

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalDate(
  value: string | null | undefined,
  label: string,
): string | null {
  const normalized = optionalText(value);
  if (normalized === null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ReferralInputError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new ReferralInputError(`${label} must be a real calendar date.`);
  }
  return normalized;
}

function validChannel(value: unknown): InteractionChannel {
  if (!isInteractionChannel(value)) {
    throw new ReferralInputError("Choose a valid channel.");
  }
  return value;
}

function validStage(value: unknown): ReferralStage {
  if (!isReferralStage(value)) {
    throw new ReferralInputError("Choose a valid referral stage.");
  }
  return value;
}

function calendarDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function ownedContact(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
) {
  return transaction
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, contactId)),
    )
    .get();
}

function ownedOpportunity(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
) {
  return transaction
    .select({ id: opportunity.id })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.id, opportunityId),
      ),
    )
    .get();
}

function mapReferralRow(found: {
  referral: Referral;
  contactName: string;
  companyName: string | null;
  role: string | null;
  applicationId: string | null;
}): ReferralListItem {
  return {
    ...found.referral,
    contactName: found.contactName,
    companyName: found.companyName,
    role: found.role,
    hasSubmittedApplication: found.applicationId !== null,
  };
}

function referralQuery(database: AppDatabase | AppTransaction) {
  return database
    .select({
      referral: referralRequest,
      contactName: contact.name,
      companyName: sql<
        string | null
      >`coalesce(${opportunityCompany.name}, ${contactCompany.name})`,
      role: opportunity.role,
      applicationId: application.id,
    })
    .from(referralRequest)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, referralRequest.workspaceId),
        eq(contact.id, referralRequest.contactId),
      ),
    )
    .leftJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, referralRequest.workspaceId),
        eq(opportunity.id, referralRequest.opportunityId),
      ),
    )
    .leftJoin(
      opportunityCompany,
      and(
        eq(opportunityCompany.workspaceId, opportunity.workspaceId),
        eq(opportunityCompany.id, opportunity.companyId),
      ),
    )
    .leftJoin(
      contactCompany,
      and(
        eq(contactCompany.workspaceId, contact.workspaceId),
        eq(contactCompany.id, contact.companyId),
      ),
    )
    .leftJoin(
      application,
      and(
        eq(application.workspaceId, referralRequest.workspaceId),
        eq(application.opportunityId, referralRequest.opportunityId),
      ),
    );
}

function selectReferral(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): ReferralListItem | undefined {
  const found = referralQuery(database)
    .where(
      and(
        eq(referralRequest.workspaceId, tenant.workspaceId),
        eq(referralRequest.id, id),
      ),
    )
    .get();
  return found ? mapReferralRow(found) : undefined;
}

export function getReferral(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): ReferralListItem | undefined {
  return selectReferral(database, tenant, id);
}

export function listReferrals(
  database: AppDatabase,
  tenant: TenantContext,
  filter: ReferralListFilter,
): ReferralListItem[] {
  const conditions = [eq(referralRequest.workspaceId, tenant.workspaceId)];

  if (filter.contactId) {
    conditions.push(eq(referralRequest.contactId, filter.contactId));
  }
  if (filter.opportunityId) {
    conditions.push(eq(referralRequest.opportunityId, filter.opportunityId));
  }
  if (filter.preset === "no_reply") {
    conditions.push(eq(referralRequest.stage, "requested"));
    conditions.push(
      lte(referralRequest.requestedOn, shiftCalendarDate(filter.asOfOn, -4)),
    );
  } else if (filter.preset === "promised_not_received") {
    conditions.push(
      inArray(referralRequest.stage, [
        "referral_promised",
        "referral_submitted",
      ]),
    );
  } else if (filter.preset === "received_not_applied") {
    conditions.push(eq(referralRequest.stage, "referral_received"));
    conditions.push(isNull(application.id));
  } else if (filter.stage) {
    conditions.push(eq(referralRequest.stage, filter.stage));
  }

  return referralQuery(database)
    .where(and(...conditions))
    .orderBy(
      desc(referralRequest.requestedOn),
      asc(contact.name),
      asc(referralRequest.id),
    )
    .all()
    .map(mapReferralRow);
}

function createValues(
  tenant: TenantContext,
  input: CreateReferralInput,
  now: Date,
) {
  const stage = input.stage ? validStage(input.stage) : DEFAULT_REFERRAL_STAGE;
  const contactId = input.contactId.trim();
  if (contactId.length === 0) {
    throw new ReferralInputError("Contact is required.");
  }
  const todayOn = input.todayOn ?? calendarDate(now);
  let requestedOn = optionalDate(input.requestedOn, "Date requested");
  let receivedOn = optionalDate(input.receivedOn, "Referral received date");
  if (stage === "requested" && requestedOn === null) {
    requestedOn = todayOn;
  }
  if (stage === "referral_received" && receivedOn === null) {
    receivedOn = todayOn;
  }

  return {
    id: input.id ?? randomUUID(),
    workspaceId: tenant.workspaceId,
    contactId,
    opportunityId: optionalText(input.opportunityId),
    requestedOn,
    channel: validChannel(input.channel),
    resumeShared: input.resumeShared === true,
    jobIdShared: input.jobIdShared === true,
    jobUrlShared: input.jobUrlShared === true,
    stage,
    followUpOn: optionalDate(input.followUpOn, "Follow-up date"),
    receivedOn,
    confirmation: optionalText(input.confirmation),
    nextAction: optionalText(input.nextAction),
    notes: optionalText(input.notes),
    createdAt: now,
  };
}

export function createReferral(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateReferralInput,
): ReferralListItem | undefined {
  const now = input.now ?? new Date();
  const values = createValues(tenant, input, now);

  return database.transaction((transaction) => {
    if (!ownedContact(transaction, tenant, values.contactId)) {
      return undefined;
    }
    if (
      values.opportunityId !== null &&
      !ownedOpportunity(transaction, tenant, values.opportunityId)
    ) {
      return undefined;
    }

    transaction.insert(referralRequest).values(values).run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "REFERRAL_CREATED",
      entityType: "referral_request",
      entityId: values.id,
      payload: {
        contactId: values.contactId,
        opportunityId: values.opportunityId,
        stage: values.stage,
      },
    });
    return selectReferral(transaction, tenant, values.id)!;
  });
}

function updateValues(
  current: ReferralListItem,
  input: UpdateReferralInput,
  now: Date,
) {
  const values: Partial<typeof referralRequest.$inferInsert> = {};
  const todayOn = input.todayOn ?? calendarDate(now);

  if (input.contactId !== undefined) {
    const contactId = optionalText(input.contactId);
    if (contactId === null) {
      throw new ReferralInputError("Contact is required.");
    }
    values.contactId = contactId;
  }
  if (input.opportunityId !== undefined) {
    values.opportunityId = optionalText(input.opportunityId);
  }
  if (input.requestedOn !== undefined) {
    values.requestedOn = optionalDate(input.requestedOn, "Date requested");
  }
  if (input.channel !== undefined) {
    values.channel = validChannel(input.channel);
  }
  if (input.resumeShared !== undefined) {
    values.resumeShared = input.resumeShared === true;
  }
  if (input.jobIdShared !== undefined) {
    values.jobIdShared = input.jobIdShared === true;
  }
  if (input.jobUrlShared !== undefined) {
    values.jobUrlShared = input.jobUrlShared === true;
  }
  if (input.stage !== undefined) {
    try {
      values.stage = transitionReferralStage(
        current.stage,
        validStage(input.stage),
      );
    } catch (error) {
      if (error instanceof ReferralStageTransitionError) {
        throw new ReferralInputError(error.message);
      }
      throw error;
    }
  }
  if (input.followUpOn !== undefined) {
    values.followUpOn = optionalDate(input.followUpOn, "Follow-up date");
  }
  if (input.receivedOn !== undefined) {
    values.receivedOn = optionalDate(input.receivedOn, "Referral received date");
  }
  if (input.confirmation !== undefined) {
    values.confirmation = optionalText(input.confirmation);
  }
  if (input.nextAction !== undefined) {
    values.nextAction = optionalText(input.nextAction);
  }
  if (input.notes !== undefined) {
    values.notes = optionalText(input.notes);
  }

  const nextStage = values.stage ?? current.stage;
  if (
    nextStage === "requested" &&
    (values.requestedOn !== undefined
      ? values.requestedOn
      : current.requestedOn) === null
  ) {
    values.requestedOn = todayOn;
  }
  if (
    nextStage === "referral_received" &&
    (values.receivedOn !== undefined
      ? values.receivedOn
      : current.receivedOn) === null
  ) {
    values.receivedOn = todayOn;
  }

  return values;
}

export function updateReferral(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateReferralInput,
): ReferralListItem | undefined {
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const current = selectReferral(transaction, tenant, id);
    if (!current) {
      return undefined;
    }
    const values = updateValues(current, input, now);
    if (Object.keys(values).length === 0) {
      return current;
    }
    if (
      values.contactId !== undefined &&
      !ownedContact(transaction, tenant, values.contactId)
    ) {
      return undefined;
    }
    if (
      values.opportunityId !== undefined &&
      values.opportunityId !== null &&
      !ownedOpportunity(transaction, tenant, values.opportunityId)
    ) {
      return undefined;
    }

    transaction
      .update(referralRequest)
      .set(values)
      .where(
        and(
          eq(referralRequest.workspaceId, tenant.workspaceId),
          eq(referralRequest.id, id),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "REFERRAL_UPDATED",
      entityType: "referral_request",
      entityId: id,
      payload: { fields: Object.keys(values).sort() },
    });
    return selectReferral(transaction, tenant, id)!;
  });
}

export function parseReferralListFilter(
  search: URLSearchParams,
  asOfOn: string,
): ReferralListFilter {
  const presetValue = search.get("preset");
  const stageValue = search.get("stage");
  const contactId = search.get("contactId") ?? undefined;
  const opportunityId = search.get("opportunityId") ?? undefined;
  return {
    asOfOn,
    preset: isReferralListPreset(presetValue) ? presetValue : undefined,
    stage: isReferralStage(stageValue) ? stageValue : undefined,
    contactId: contactId || undefined,
    opportunityId: opportunityId || undefined,
  };
}
