import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  DEFAULT_NETWORKING_STATUS,
  isContactMethodKind,
  isContactRelationship,
  isNetworkingStatus,
  transitionNetworkingStatus,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "../../domain/contact";
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

export type Contact = typeof contact.$inferSelect;
export type ContactMethod = typeof contactMethod.$inferSelect;
export type ContactListItem = Contact & { companyName: string | null };
export type ContactDetail = ContactListItem & { methods: ContactMethod[] };

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

function normalizeLinkedIn(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString().replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
}

function normalizeMethodValue(kind: ContactMethodKind, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContactInputError("Contact method value is required.");
  }

  const normalized =
    kind === "email"
      ? normalizeEmail(trimmed)
      : kind === "linkedin"
        ? normalizeLinkedIn(trimmed)
        : kind === "phone" || kind === "whatsapp"
          ? normalizePhone(trimmed)
          : trimmed.toLowerCase();

  if (normalized === null) {
    throw new ContactInputError(`Enter a valid ${kind} contact method.`);
  }
  return normalized;
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
    const value = method.value.trim();
    return {
      ...method,
      value,
      normalized: normalizeMethodValue(method.kind, value),
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
): ContactListItem[] {
  return database
    .select({ contact, companyName: company.name })
    .from(contact)
    .leftJoin(
      company,
      and(
        eq(company.workspaceId, contact.workspaceId),
        eq(company.id, contact.companyId),
      ),
    )
    .where(eq(contact.workspaceId, tenant.workspaceId))
    .orderBy(asc(contact.name), asc(contact.id))
    .all()
    .map(({ contact: row, companyName }) => ({ ...row, companyName }));
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
    .orderBy(asc(contactMethod.kind), asc(contactMethod.id))
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
