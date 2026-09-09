import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import {
  CONTACT_RELATIONSHIPS,
  DEFAULT_NETWORKING_STATUS,
  NETWORKING_STATUSES,
  isContactMethodKind,
  isContactRelationship,
  isNetworkingStatus,
  transitionNetworkingStatus,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "../../domain/contact";
import { canonicalHttpUrl } from "../../domain/web-url";
import {
  filterOptionValue,
  positiveDayCount,
} from "../../domain/list-filter";
import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company, contact, contactMethod } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import {
  createCompanyInTransaction,
  findCompanyByName,
} from "./companies";
import {
  clearEntityTagsInTransaction,
  replaceEntityTagsInTransaction,
} from "./tags";
import { syncContactSuppressionInTransaction } from "./send-safety";

export type Contact = typeof contact.$inferSelect;
export type ContactMethod = typeof contactMethod.$inferSelect;
/**
 * A list row carries the destinations a card offers (D-064) so the list costs
 * two queries rather than one per contact. Null means the contact genuinely has
 * no such destination saved, which is what the disabled control states.
 */
export type ContactListItem = Contact & {
  companyName: string | null;
  emailAddress: string | null;
  linkedinUrl: string | null;
};
/** Detail holds every method, so it does not carry the list row's two picks. */
export type ContactDetail = Contact & {
  companyName: string | null;
  methods: ContactMethod[];
};

export type ContactListFilter = {
  companyId?: string;
  relationship?: ContactRelationship;
  status?: NetworkingStatus;
  noResponseDays?: number;
  asOf?: Date;
};

export type ContactMethodInput = {
  id?: string;
  kind: ContactMethodKind;
  value: string;
  isPrimary?: boolean;
};

export type CreateContactInput = {
  id?: string;
  companyId?: string | null;
  companyName?: string | null;
  name: string;
  designation?: string | null;
  relationship?: ContactRelationship;
  source?: string | null;
  location?: string | null;
  notes?: string | null;
  tags?: string[];
  preferredContactChannel?: ContactMethodKind | null;
  networkingStatus?: NetworkingStatus;
  lastInteractionAt?: Date | null;
  nextAction?: string | null;
  followUpOn?: string | null;
  methods?: ContactMethodInput[];
  now?: Date;
};

export type UpdateContactInput = Partial<
  Pick<
    CreateContactInput,
    | "companyId"
    | "companyName"
    | "name"
    | "designation"
    | "relationship"
    | "source"
    | "location"
    | "notes"
    | "tags"
    | "preferredContactChannel"
    | "networkingStatus"
    | "lastInteractionAt"
    | "nextAction"
    | "followUpOn"
    | "methods"
  >
> & { overrideDoNotContact?: boolean };

export class ContactInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactInputError";
  }
}

function requiredName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ContactInputError("Contact name is required.");
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

function normalizedTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      throw new ContactInputError("Tags must be text.");
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

function validFollowUpOn(value: string | null | undefined): string | null {
  const normalized = optionalText(value);
  if (normalized === null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ContactInputError("Follow-up date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new ContactInputError("Follow-up date must be a real calendar date.");
  }
  return normalized;
}

function validInstant(value: Date | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new ContactInputError("Last interaction must be a valid instant.");
  }
  return value;
}

function relationship(value: unknown): ContactRelationship {
  if (!isContactRelationship(value)) {
    throw new ContactInputError("Choose a valid relationship.");
  }
  return value;
}

function status(value: unknown): NetworkingStatus {
  if (!isNetworkingStatus(value)) {
    throw new ContactInputError("Choose a valid networking status.");
  }
  return value;
}

function preferredChannel(value: unknown): ContactMethodKind | null {
  if (value === null) {
    return null;
  }
  if (!isContactMethodKind(value)) {
    throw new ContactInputError("Choose a valid preferred channel.");
  }
  return value;
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 ? `${leadingPlus ? "+" : ""}${digits}` : null;
}

function prepareMethodValue(
  kind: ContactMethodKind,
  value: string,
): { normalized: string; value: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContactInputError("Contact method value is required.");
  }

  if (kind === "linkedin") {
    const url = canonicalHttpUrl(trimmed, { inferHttps: true });
    if (!url) {
      throw new ContactInputError("Enter a valid linkedin contact method.");
    }
    return { normalized: url, value: url };
  }

  if (kind === "other") {
    const url = canonicalHttpUrl(trimmed);
    return url
      ? { normalized: url, value: url }
      : { normalized: trimmed.toLowerCase(), value: trimmed };
  }

  const normalized = kind === "email" ? normalizeEmail(trimmed) : normalizePhone(trimmed);

  if (normalized === null) {
    throw new ContactInputError(`Enter a valid ${kind} contact method.`);
  }
  return { normalized, value: trimmed };
}

type PreparedMethod = ContactMethodInput & { value: string; normalized: string };

function prepareMethods(methods: ContactMethodInput[] | undefined): PreparedMethod[] {
  if (methods === undefined) {
    return [];
  }

  const prepared = methods.map((method) => {
    if (!isContactMethodKind(method.kind)) {
      throw new ContactInputError("Choose a valid contact method kind.");
    }
    const preparedValue = prepareMethodValue(method.kind, method.value);
    return {
      ...method,
      ...preparedValue,
    };
  });
  if (prepared.filter(({ isPrimary }) => isPrimary === true).length > 1) {
    throw new ContactInputError("Choose only one primary contact method.");
  }

  const keys = new Set<string>();
  for (const method of prepared) {
    const key = `${method.kind}:${method.normalized}`;
    if (keys.has(key)) {
      throw new ContactInputError("A contact method cannot be repeated.");
    }
    keys.add(key);
  }
  return prepared;
}

function requireOwnedCompany(
  transaction: AppTransaction,
  tenant: TenantContext,
  companyId: string | null,
): void {
  if (companyId === null) {
    return;
  }
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
    throw new ContactInputError("Company not found.");
  }
}

function resolveCompanyLink(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: { companyId?: string | null; companyName?: string | null },
  now: Date,
): string | null {
  const companyId = optionalText(input.companyId);
  const companyName = optionalText(input.companyName);
  if (companyId !== null && companyName !== null) {
    throw new ContactInputError(
      "Send a company id or a company name, not both.",
    );
  }
  if (companyId !== null) {
    requireOwnedCompany(transaction, tenant, companyId);
    return companyId;
  }
  if (companyName === null) {
    return null;
  }
  const existing = findCompanyByName(transaction, tenant, companyName);
  if (existing) {
    return existing.id;
  }
  return createCompanyInTransaction(transaction, tenant, {
    name: companyName,
    now,
  }).id;
}

function insertMethods(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
  methods: PreparedMethod[],
  now: Date,
): void {
  for (const method of methods) {
    const duplicate = transaction
      .select({ id: contactMethod.id })
      .from(contactMethod)
      .where(
        and(
          eq(contactMethod.workspaceId, tenant.workspaceId),
          eq(contactMethod.kind, method.kind),
          eq(contactMethod.valueNormalized, method.normalized),
        ),
      )
      .get();
    if (duplicate) {
      throw new ContactInputError(
        "That contact method is already used in this workspace.",
      );
    }

    transaction
      .insert(contactMethod)
      .values({
        id: method.id ?? randomUUID(),
        workspaceId: tenant.workspaceId,
        contactId,
        kind: method.kind,
        value: method.value,
        valueNormalized: method.normalized,
        isPrimary: method.isPrimary ?? false,
        createdAt: now,
      })
      .run();
  }
}

export function createContact(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateContactInput,
): ContactDetail {
  return database.transaction((transaction) =>
    createContactInTransaction(transaction, tenant, input),
  );
}

export function createContactInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: CreateContactInput,
): ContactDetail {
  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  const methods = prepareMethods(input.methods);
  const companyId = resolveCompanyLink(transaction, tenant, input, now);
  transaction
    .insert(contact)
    .values({
      id,
      workspaceId: tenant.workspaceId,
      companyId,
      name: requiredName(input.name),
      designation: optionalText(input.designation),
      relationship: relationship(input.relationship ?? "unknown_cold_contact"),
      source: optionalText(input.source),
      location: optionalText(input.location),
      notes: optionalText(input.notes),
      tagsJson: normalizedTags(input.tags),
      preferredContactChannel:
        input.preferredContactChannel === undefined
          ? null
          : preferredChannel(input.preferredContactChannel),
      networkingStatus: status(input.networkingStatus ?? DEFAULT_NETWORKING_STATUS),
      lastInteractionAt: validInstant(input.lastInteractionAt),
      nextAction: optionalText(input.nextAction),
      followUpOn: validFollowUpOn(input.followUpOn),
      createdAt: now,
    })
    .run();
  insertMethods(transaction, tenant, id, methods, now);
  syncContactSuppressionInTransaction(
    transaction,
    tenant,
    id,
    input.networkingStatus ?? DEFAULT_NETWORKING_STATUS,
    now,
  );
  replaceEntityTagsInTransaction(
    transaction,
    tenant,
    "contact",
    id,
    input.tags ?? [],
    now,
  );
  logEvent(transaction, tenant, {
    at: now,
    kind: "CONTACT_CREATED",
    entityType: "contact",
    entityId: id,
  });

  return getContact(transaction, tenant, id)!;
}

export function listContacts(
  database: AppDatabase,
  tenant: TenantContext,
  filter: ContactListFilter = {},
): ContactListItem[] {
  const conditions = [eq(contact.workspaceId, tenant.workspaceId)];
  if (filter.companyId) {
    conditions.push(eq(contact.companyId, filter.companyId));
  }
  if (filter.relationship) {
    conditions.push(eq(contact.relationship, filter.relationship));
  }
  if (filter.status) {
    conditions.push(eq(contact.networkingStatus, filter.status));
  }
  if (filter.noResponseDays !== undefined) {
    const asOf = filter.asOf ?? new Date();
    const threshold = new Date(
      asOf.getTime() - filter.noResponseDays * 24 * 60 * 60 * 1000,
    );
    conditions.push(eq(contact.networkingStatus, "waiting_for_reply"));
    conditions.push(lte(contact.lastInteractionAt, threshold));
  }
  const rows = database
    .select({ contact, companyName: company.name })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.workspaceId, contact.workspaceId),
        eq(company.id, contact.companyId),
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(contact.name), asc(contact.id))
    .all();
  const destinations = contactDestinations(
    database,
    tenant,
    rows.map(({ contact: row }) => row.id),
  );
  return rows.map(({ contact: row, companyName }) => ({
    ...row,
    companyName,
    emailAddress: destinations.get(row.id)?.emailAddress ?? null,
    linkedinUrl: destinations.get(row.id)?.linkedinUrl ?? null,
  }));
}

/**
 * One workspace-scoped pass over the two method kinds a card can act on. A
 * contact's primary method wins; otherwise the first by normalized value, so the
 * choice does not change between two identical page loads.
 */
function contactDestinations(
  database: AppDatabase,
  tenant: TenantContext,
  contactIds: string[],
): Map<string, { emailAddress: string | null; linkedinUrl: string | null }> {
  const found = new Map<
    string,
    { emailAddress: string | null; linkedinUrl: string | null }
  >();
  if (contactIds.length === 0) return found;

  const methods = database
    .select({
      contactId: contactMethod.contactId,
      kind: contactMethod.kind,
      value: contactMethod.value,
      isPrimary: contactMethod.isPrimary,
    })
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        inArray(contactMethod.contactId, contactIds),
        inArray(contactMethod.kind, ["email", "linkedin"]),
      ),
    )
    .orderBy(
      asc(contactMethod.contactId),
      asc(contactMethod.kind),
      asc(contactMethod.valueNormalized),
      asc(contactMethod.id),
    )
    .all();

  const chosenIsPrimary = new Set<string>();
  for (const method of methods) {
    const key = method.kind === "email" ? "emailAddress" : "linkedinUrl";
    const current = found.get(method.contactId) ?? {
      emailAddress: null,
      linkedinUrl: null,
    };
    const marker = `${method.contactId}:${key}`;
    const unset = current[key] === null;
    // The primary wins; among equals the first in the deterministic order does.
    if (unset || (method.isPrimary && !chosenIsPrimary.has(marker))) {
      current[key] = method.value;
      if (method.isPrimary) chosenIsPrimary.add(marker);
      found.set(method.contactId, current);
    } else if (unset) {
      found.set(method.contactId, current);
    }
  }
  return found;
}

export function parseContactListFilter(
  search: URLSearchParams,
  now?: Date,
): ContactListFilter {
  const companyId = search.get("company")?.trim() || undefined;
  const relationship = filterOptionValue(
    CONTACT_RELATIONSHIPS,
    search.get("relationship"),
  ) as ContactRelationship | undefined;
  const status = filterOptionValue(
    NETWORKING_STATUSES,
    search.get("status"),
  ) as NetworkingStatus | undefined;
  const noResponseDays = positiveDayCount(search.get("noResponseDays"));
  return {
    ...(companyId ? { companyId } : {}),
    ...(relationship ? { relationship } : {}),
    ...(status ? { status } : {}),
    ...(noResponseDays !== undefined
      ? { noResponseDays, asOf: now ?? new Date() }
      : {}),
  };
}

export function getContact(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): ContactDetail | undefined {
  const found = database
    .select({ contact, companyName: company.name })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.workspaceId, contact.workspaceId),
        eq(company.id, contact.companyId),
      ),
    )
    .where(
      and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, id)),
    )
    .get();
  if (!found) {
    return undefined;
  }

  const methods = database
    .select()
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.contactId, id),
      ),
    )
    // Two methods of one kind were ordered by a random uuid, so the list came
    // back in a different order run to run — random on screen, and a coin-flip
    // in the tests that assert it.
    .orderBy(
      asc(contactMethod.kind),
      asc(contactMethod.valueNormalized),
      asc(contactMethod.id),
    )
    .all();
  return { ...found.contact, companyName: found.companyName, methods };
}

function updateValues(current: Contact, input: UpdateContactInput) {
  const values: Partial<typeof contact.$inferInsert> = {};

  if (input.companyId !== undefined)
    values.companyId = optionalText(input.companyId);
  if (input.name !== undefined) values.name = requiredName(input.name);
  if (input.designation !== undefined)
    values.designation = optionalText(input.designation);
  if (input.relationship !== undefined)
    values.relationship = relationship(input.relationship);
  if (input.source !== undefined) values.source = optionalText(input.source);
  if (input.location !== undefined)
    values.location = optionalText(input.location);
  if (input.notes !== undefined) values.notes = optionalText(input.notes);
  if (input.preferredContactChannel !== undefined)
    values.preferredContactChannel = preferredChannel(
      input.preferredContactChannel,
    );
  if (input.networkingStatus !== undefined)
    values.networkingStatus = transitionNetworkingStatus(
      current.networkingStatus,
      status(input.networkingStatus),
      { overrideDoNotContact: input.overrideDoNotContact },
    );
  if (input.lastInteractionAt !== undefined)
    values.lastInteractionAt = validInstant(input.lastInteractionAt);
  if (input.nextAction !== undefined)
    values.nextAction = optionalText(input.nextAction);
  if (input.followUpOn !== undefined)
    values.followUpOn = validFollowUpOn(input.followUpOn);

  return values;
}

export function updateContact(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateContactInput,
  at = new Date(),
): ContactDetail | undefined {
  const preparedMethods =
    input.methods === undefined ? undefined : prepareMethods(input.methods);
  const updated = database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(contact)
      .where(
        and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, id)),
      )
      .get();
    if (!current) {
      return false;
    }

    if (input.companyId !== undefined && input.companyName !== undefined) {
      throw new ContactInputError(
        "Send a company id or a company name, not both.",
      );
    }
    const values = updateValues(current, input);
    if (input.companyName !== undefined) {
      values.companyId = resolveCompanyLink(
        transaction,
        tenant,
        { companyName: input.companyName },
        at,
      );
    } else if (input.companyId !== undefined) {
      requireOwnedCompany(transaction, tenant, values.companyId ?? null);
    }
    if (Object.keys(values).length > 0) {
      transaction
        .update(contact)
        .set(values)
        .where(
          and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, id)),
        )
        .run();
    }
    if (preparedMethods !== undefined) {
      transaction
        .delete(contactMethod)
        .where(
          and(
            eq(contactMethod.workspaceId, tenant.workspaceId),
            eq(contactMethod.contactId, id),
          ),
        )
        .run();
      insertMethods(transaction, tenant, id, preparedMethods, at);
    }
    const nextStatus = values.networkingStatus ?? current.networkingStatus;
    if (preparedMethods !== undefined || input.networkingStatus !== undefined) {
      syncContactSuppressionInTransaction(
        transaction,
        tenant,
        id,
        nextStatus,
        at,
      );
    }
    if (input.tags !== undefined) {
      replaceEntityTagsInTransaction(
        transaction,
        tenant,
        "contact",
        id,
        input.tags,
        at,
      );
    }

    const fields = Object.keys(values);
    if (preparedMethods !== undefined) {
      fields.push("methods");
    }
    if (input.tags !== undefined) {
      fields.push("tags");
    }
    if (fields.length > 0) {
      logEvent(transaction, tenant, {
        at,
        kind: "CONTACT_UPDATED",
        entityType: "contact",
        entityId: id,
        payload: { fields: fields.sort() },
      });
    }
    return true;
  });

  return updated ? getContact(database, tenant, id) : undefined;
}

export function deleteContact(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const current = transaction
      .select({ id: contact.id })
      .from(contact)
      .where(
        and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, id)),
      )
      .get();
    if (!current) {
      return false;
    }

    clearEntityTagsInTransaction(transaction, tenant, "contact", id);
    syncContactSuppressionInTransaction(
      transaction,
      tenant,
      id,
      "inactive",
      at,
    );

    transaction
      .delete(contact)
      .where(
        and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, id)),
      )
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "CONTACT_DELETED",
      entityType: "contact",
      entityId: id,
    });
    return true;
  });
}
