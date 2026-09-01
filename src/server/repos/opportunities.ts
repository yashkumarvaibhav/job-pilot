import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  DEFAULT_OPPORTUNITY_BUCKET,
  DEFAULT_OPPORTUNITY_STAGE,
  isOpportunityBucket,
  isOpportunitySelectableStage,
  type OpportunityBucket,
  type OpportunitySelectableStage,
} from "../../domain/opportunity";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  company,
  contact,
  interaction,
  opportunity,
  opportunityContact,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type Opportunity = typeof opportunity.$inferSelect;
export type OpportunityListItem = Opportunity & { companyName: string };
export type OpportunityListFilter = OpportunityBucket | "all";

export type CreateOpportunityInput = {
  id?: string;
  companyId: string;
  role: string;
  jobId?: string | null;
  url?: string | null;
  location?: string | null;
  workMode?: string | null;
  employmentType?: string | null;
  experienceRequirement?: string | null;
  source?: string | null;
  discoveredOn?: string | null;
  postedOn?: string | null;
  deadlineOn?: string | null;
  compensation?: string | null;
  priority?: string | null;
  interestScore?: number | null;
  eligibility?: string | null;
  referralPreferred?: boolean;
  resumeVersionId?: string | null;
  jdSnapshot?: string | null;
  notes?: string | null;
  tags?: string[];
  bucket?: OpportunityBucket;
  stage?: OpportunitySelectableStage;
  nextAction?: string | null;
  now?: Date;
};

export type UpdateOpportunityInput = Partial<
  Pick<
    CreateOpportunityInput,
    | "companyId"
    | "role"
    | "jobId"
    | "url"
    | "location"
    | "workMode"
    | "employmentType"
    | "experienceRequirement"
    | "source"
    | "discoveredOn"
    | "postedOn"
    | "deadlineOn"
    | "compensation"
    | "priority"
    | "interestScore"
    | "eligibility"
    | "referralPreferred"
    | "resumeVersionId"
    | "jdSnapshot"
    | "notes"
    | "tags"
    | "bucket"
    | "stage"
    | "nextAction"
  >
>;

export type CreateOpportunityFromConversationInput = {
  id?: string;
  contactId: string;
  role: string;
  jobId?: string | null;
  companyId?: string | null;
  now?: Date;
};

export type LinkedContact = {
  linkId: string;
  opportunityId: string;
  contactId: string;
  contactName: string;
  companyName: string | null;
  createdAt: Date;
};

export type LinkedOpportunity = OpportunityListItem & { linkId: string };

export class OpportunityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new OpportunityInputError(`${label} is required.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalHttpUrl(
  value: string | null | undefined,
): string | null {
  const normalized = optionalText(value);
  if (normalized === null) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return normalized;
    }
  } catch {
    // The shared validation error below keeps route responses deterministic.
  }

  throw new OpportunityInputError("Job URL must use http or https.");
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
    throw new OpportunityInputError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new OpportunityInputError(`${label} must be a real calendar date.`);
  }
  return normalized;
}

function optionalInteger(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    throw new OpportunityInputError("Interest score must be a whole number.");
  }
  return value;
}

function normalizedTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      throw new OpportunityInputError("Tags must be text.");
    }
    const normalized = tag.trim();
    const key = normalized.toLowerCase();
    if (normalized.length > 0 && !seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }
  return unique;
}

function validBucket(value: unknown): OpportunityBucket {
  if (!isOpportunityBucket(value)) {
    throw new OpportunityInputError("Choose Saved or Active.");
  }
  return value;
}

function validSelectableStage(value: unknown): OpportunitySelectableStage {
  if (!isOpportunitySelectableStage(value)) {
    throw new OpportunityInputError("Choose a valid pursuit stage.");
  }
  return value;
}

function requireOwnedCompany(
  transaction: AppTransaction,
  tenant: TenantContext,
  companyId: string,
): void {
  const found = transaction
    .select({ id: company.id })
    .from(company)
    .where(
      and(
        eq(company.workspaceId, tenant.workspaceId),
        eq(company.id, companyId),
      ),
    )
    .get();
  if (!found) {
    throw new OpportunityInputError("Company not found.");
  }
}

function requireOwnedContact(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
) {
  return transaction
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.id, contactId),
      ),
    )
    .get();
}

function selectOpportunity(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): OpportunityListItem | undefined {
  const found = database
    .select({ opportunity, companyName: company.name })
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
        eq(opportunity.id, id),
      ),
    )
    .get();

  return found
    ? { ...found.opportunity, companyName: found.companyName }
    : undefined;
}

function selectLinkedContact(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
  contactId: string,
): LinkedContact | undefined {
  const found = database
    .select({
      link: opportunityContact,
      contactName: contact.name,
      companyName: company.name,
    })
    .from(opportunityContact)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, opportunityContact.workspaceId),
        eq(contact.id, opportunityContact.contactId),
      ),
    )
    .leftJoin(
      company,
      and(
        eq(company.workspaceId, contact.workspaceId),
        eq(company.id, contact.companyId),
      ),
    )
    .where(
      and(
        eq(opportunityContact.workspaceId, tenant.workspaceId),
        eq(opportunityContact.opportunityId, opportunityId),
        eq(opportunityContact.contactId, contactId),
      ),
    )
    .get();

  return found
    ? {
        linkId: found.link.id,
        opportunityId: found.link.opportunityId,
        contactId: found.link.contactId,
        contactName: found.contactName,
        companyName: found.companyName,
        createdAt: found.link.createdAt,
      }
    : undefined;
}

function contactHasLoggedOpening(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  contactId: string,
): boolean {
  return (
    database
      .select({ id: interaction.id })
      .from(interaction)
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.contactId, contactId),
        ),
      )
      .all().length > 0
  );
}

function writeOpportunity(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: CreateOpportunityInput,
): OpportunityListItem {
  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  const companyId = requiredText(input.companyId, "Company");

  requireOwnedCompany(transaction, tenant, companyId);
  transaction
    .insert(opportunity)
    .values({
      id,
      workspaceId: tenant.workspaceId,
      companyId,
      role: requiredText(input.role, "Role"),
      jobId: optionalText(input.jobId),
      url: optionalHttpUrl(input.url),
      location: optionalText(input.location),
      workMode: optionalText(input.workMode),
      employmentType: optionalText(input.employmentType),
      experienceRequirement: optionalText(input.experienceRequirement),
      source: optionalText(input.source),
      discoveredOn: optionalDate(input.discoveredOn, "Date discovered"),
      postedOn: optionalDate(input.postedOn, "Posting date"),
      deadlineOn: optionalDate(input.deadlineOn, "Deadline"),
      compensation: optionalText(input.compensation),
      priority: optionalText(input.priority),
      interestScore: optionalInteger(input.interestScore),
      eligibility: optionalText(input.eligibility),
      referralPreferred: input.referralPreferred ?? false,
      resumeVersionId: optionalText(input.resumeVersionId),
      jdSnapshot: optionalText(input.jdSnapshot),
      notes: optionalText(input.notes),
      tagsJson: normalizedTags(input.tags),
      bucket: validBucket(input.bucket ?? DEFAULT_OPPORTUNITY_BUCKET),
      stage: validSelectableStage(input.stage ?? DEFAULT_OPPORTUNITY_STAGE),
      nextAction: optionalText(input.nextAction),
      createdAt: now,
    })
    .run();
  logEvent(transaction, tenant, {
    at: now,
    kind: "OPPORTUNITY_CREATED",
    entityType: "opportunity",
    entityId: id,
  });

  return selectOpportunity(transaction, tenant, id)!;
}

function writeOpportunityContactLink(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
  contactId: string,
  at: Date,
): LinkedContact {
  const existing = selectLinkedContact(
    transaction,
    tenant,
    opportunityId,
    contactId,
  );
  if (existing) {
    return existing;
  }

  const id = randomUUID();
  transaction
    .insert(opportunityContact)
    .values({
      id,
      workspaceId: tenant.workspaceId,
      opportunityId,
      contactId,
      createdAt: at,
    })
    .run();
  logEvent(transaction, tenant, {
    at,
    kind: "OPPORTUNITY_CONTACT_LINKED",
    entityType: "opportunity",
    entityId: opportunityId,
    payload: { contactId },
  });

  return selectLinkedContact(transaction, tenant, opportunityId, contactId)!;
}

export function createOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateOpportunityInput,
): OpportunityListItem {
  return database.transaction((transaction) =>
    writeOpportunity(transaction, tenant, input),
  );
}

export function listOpportunities(
  database: AppDatabase,
  tenant: TenantContext,
  filter: OpportunityListFilter = "all",
): OpportunityListItem[] {
  const filterCondition =
    filter === "all"
      ? eq(opportunity.workspaceId, tenant.workspaceId)
      : and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.bucket, filter),
        );

  return database
    .select({ opportunity, companyName: company.name })
    .from(opportunity)
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(filterCondition)
    .orderBy(asc(company.name), asc(opportunity.role), asc(opportunity.id))
    .all()
    .map(({ opportunity: row, companyName }) => ({ ...row, companyName }));
}

export function getOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): OpportunityListItem | undefined {
  return selectOpportunity(database, tenant, id);
}

function updateValues(input: UpdateOpportunityInput) {
  const values: Partial<typeof opportunity.$inferInsert> = {};

  if (input.companyId !== undefined)
    values.companyId = requiredText(input.companyId, "Company");
  if (input.role !== undefined) values.role = requiredText(input.role, "Role");
  if (input.jobId !== undefined) values.jobId = optionalText(input.jobId);
  if (input.url !== undefined) values.url = optionalHttpUrl(input.url);
  if (input.location !== undefined)
    values.location = optionalText(input.location);
  if (input.workMode !== undefined)
    values.workMode = optionalText(input.workMode);
  if (input.employmentType !== undefined)
    values.employmentType = optionalText(input.employmentType);
  if (input.experienceRequirement !== undefined)
    values.experienceRequirement = optionalText(input.experienceRequirement);
  if (input.source !== undefined) values.source = optionalText(input.source);
  if (input.discoveredOn !== undefined)
    values.discoveredOn = optionalDate(input.discoveredOn, "Date discovered");
  if (input.postedOn !== undefined)
    values.postedOn = optionalDate(input.postedOn, "Posting date");
  if (input.deadlineOn !== undefined)
    values.deadlineOn = optionalDate(input.deadlineOn, "Deadline");
  if (input.compensation !== undefined)
    values.compensation = optionalText(input.compensation);
  if (input.priority !== undefined)
    values.priority = optionalText(input.priority);
  if (input.interestScore !== undefined)
    values.interestScore = optionalInteger(input.interestScore);
  if (input.eligibility !== undefined)
    values.eligibility = optionalText(input.eligibility);
  if (input.referralPreferred !== undefined)
    values.referralPreferred = input.referralPreferred;
  if (input.resumeVersionId !== undefined)
    values.resumeVersionId = optionalText(input.resumeVersionId);
  if (input.jdSnapshot !== undefined)
    values.jdSnapshot = optionalText(input.jdSnapshot);
  if (input.notes !== undefined) values.notes = optionalText(input.notes);
  if (input.tags !== undefined) values.tagsJson = normalizedTags(input.tags);
  if (input.bucket !== undefined) values.bucket = validBucket(input.bucket);
  if (input.stage !== undefined)
    values.stage = validSelectableStage(input.stage);
  if (input.nextAction !== undefined)
    values.nextAction = optionalText(input.nextAction);

  return values;
}

export function updateOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateOpportunityInput,
  at = new Date(),
): OpportunityListItem | undefined {
  const values = updateValues(input);

  return database.transaction((transaction) => {
    const current = selectOpportunity(transaction, tenant, id);
    if (!current) {
      return undefined;
    }
    if (values.companyId !== undefined) {
      requireOwnedCompany(transaction, tenant, values.companyId);
    }
    if (Object.keys(values).length === 0) {
      return current;
    }

    transaction
      .update(opportunity)
      .set(values)
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.id, id),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "OPPORTUNITY_UPDATED",
      entityType: "opportunity",
      entityId: id,
      payload: { fields: Object.keys(values).sort() },
    });

    return selectOpportunity(transaction, tenant, id)!;
  });
}

export function linkContactToOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  opportunityId: string,
  contactId: string,
  at = new Date(),
): LinkedContact | undefined {
  return database.transaction((transaction) => {
    if (!selectOpportunity(transaction, tenant, opportunityId)) {
      return undefined;
    }
    if (!requireOwnedContact(transaction, tenant, contactId)) {
      return undefined;
    }
    return writeOpportunityContactLink(
      transaction,
      tenant,
      opportunityId,
      contactId,
      at,
    );
  });
}

export function listOpportunityContacts(
  database: AppDatabase,
  tenant: TenantContext,
  opportunityId: string,
): LinkedContact[] {
  return database
    .select({
      link: opportunityContact,
      contactName: contact.name,
      companyName: company.name,
    })
    .from(opportunityContact)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, opportunityContact.workspaceId),
        eq(contact.id, opportunityContact.contactId),
      ),
    )
    .leftJoin(
      company,
      and(
        eq(company.workspaceId, contact.workspaceId),
        eq(company.id, contact.companyId),
      ),
    )
    .where(
      and(
        eq(opportunityContact.workspaceId, tenant.workspaceId),
        eq(opportunityContact.opportunityId, opportunityId),
      ),
    )
    .orderBy(asc(contact.name), asc(contact.id))
    .all()
    .map(({ link, contactName, companyName }) => ({
      linkId: link.id,
      opportunityId: link.opportunityId,
      contactId: link.contactId,
      contactName,
      companyName,
      createdAt: link.createdAt,
    }));
}

export function listContactOpportunities(
  database: AppDatabase,
  tenant: TenantContext,
  contactId: string,
): LinkedOpportunity[] {
  return database
    .select({
      opportunity,
      companyName: company.name,
      linkId: opportunityContact.id,
    })
    .from(opportunityContact)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, opportunityContact.workspaceId),
        eq(opportunity.id, opportunityContact.opportunityId),
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
        eq(opportunityContact.workspaceId, tenant.workspaceId),
        eq(opportunityContact.contactId, contactId),
      ),
    )
    .orderBy(asc(company.name), asc(opportunity.role), asc(opportunity.id))
    .all()
    .map(({ opportunity: row, companyName, linkId }) => ({
      ...row,
      companyName,
      linkId,
    }));
}

export function createOpportunityFromConversation(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateOpportunityFromConversationInput,
): OpportunityListItem | undefined {
  return database.transaction((transaction) => {
    const ownedContact = requireOwnedContact(
      transaction,
      tenant,
      input.contactId,
    );
    if (!ownedContact) {
      return undefined;
    }
    if (!contactHasLoggedOpening(transaction, tenant, ownedContact.id)) {
      throw new OpportunityInputError("Log the opening first.");
    }

    const companyId =
      optionalText(input.companyId) ?? ownedContact.companyId ?? "";
    const created = writeOpportunity(transaction, tenant, {
      id: input.id,
      companyId,
      role: input.role,
      jobId: input.jobId,
      source: "Conversation",
      now: input.now,
    });
    writeOpportunityContactLink(
      transaction,
      tenant,
      created.id,
      ownedContact.id,
      input.now ?? created.createdAt,
    );
    return created;
  });
}
