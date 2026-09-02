import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import {
  clearEntityTagsInTransaction,
  replaceEntityTagsInTransaction,
} from "./tags";

export type Company = typeof company.$inferSelect;

export type CreateCompanyInput = {
  id?: string;
  name: string;
  website?: string | null;
  careersUrl?: string | null;
  industry?: string | null;
  type?: string | null;
  locations?: string | null;
  target?: boolean;
  notes?: string | null;
  tags?: string[];
  nextAction?: string | null;
  nextActionDue?: string | null;
  now?: Date;
};

export type UpdateCompanyInput = Partial<
  Pick<
    CreateCompanyInput,
    | "name"
    | "website"
    | "careersUrl"
    | "industry"
    | "type"
    | "locations"
    | "target"
    | "notes"
    | "tags"
    | "nextAction"
    | "nextActionDue"
  >
>;

export class CompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyInputError";
  }
}

function requiredName(value: string): string {
  const name = value.trim();

  if (name.length === 0) {
    throw new CompanyInputError("Company name is required.");
  }

  return name;
}

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
    throw new CompanyInputError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new CompanyInputError(`${label} must be a real calendar date.`);
  }
  return normalized;
}

function optionalHttpUrl(
  value: string | null | undefined,
  label: string,
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

  throw new CompanyInputError(`${label} must use http or https.`);
}

export function createCompany(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateCompanyInput,
): Company {
  return database.transaction((transaction) =>
    createCompanyInTransaction(transaction, tenant, input),
  );
}

export function createCompanyInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: CreateCompanyInput,
): Company {
  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  const created = transaction
    .insert(company)
    .values({
      id,
      workspaceId: tenant.workspaceId,
      name: requiredName(input.name),
      website: optionalHttpUrl(input.website, "Website"),
      careersUrl: optionalHttpUrl(input.careersUrl, "Careers URL"),
      industry: optionalText(input.industry),
      type: optionalText(input.type),
      locations: optionalText(input.locations),
      target: input.target ?? false,
      notes: optionalText(input.notes),
      nextAction: optionalText(input.nextAction),
      nextActionDue: optionalDate(input.nextActionDue, "Next action due"),
      createdAt: now,
    })
    .returning()
    .get();

  if (input.tags !== undefined) {
    replaceEntityTagsInTransaction(
      transaction,
      tenant,
      "company",
      created.id,
      input.tags,
      now,
    );
  }

  logEvent(transaction, tenant, {
    at: now,
    kind: "COMPANY_CREATED",
    entityType: "company",
    entityId: created.id,
  });

  return created;
}

export function listCompanies(
  database: AppDatabase,
  tenant: TenantContext,
): Company[] {
  return database
    .select()
    .from(company)
    .where(eq(company.workspaceId, tenant.workspaceId))
    .orderBy(asc(company.name), asc(company.id))
    .all();
}

export function getCompany(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): Company | undefined {
  return database
    .select()
    .from(company)
    .where(
      and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, id)),
    )
    .get();
}

export function findCompanyByName(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  name: string,
): Company | undefined {
  const needle = name.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return undefined;
  }

  return database
    .select()
    .from(company)
    .where(eq(company.workspaceId, tenant.workspaceId))
    .orderBy(asc(company.name), asc(company.id))
    .all()
    .find((row) => row.name.toLocaleLowerCase() === needle);
}

function updateValues(input: UpdateCompanyInput) {
  const values: Partial<typeof company.$inferInsert> = {};

  if (input.name !== undefined) values.name = requiredName(input.name);
  if (input.website !== undefined)
    values.website = optionalHttpUrl(input.website, "Website");
  if (input.careersUrl !== undefined)
    values.careersUrl = optionalHttpUrl(input.careersUrl, "Careers URL");
  if (input.industry !== undefined)
    values.industry = optionalText(input.industry);
  if (input.type !== undefined) values.type = optionalText(input.type);
  if (input.locations !== undefined)
    values.locations = optionalText(input.locations);
  if (input.target !== undefined) values.target = input.target;
  if (input.notes !== undefined) values.notes = optionalText(input.notes);
  if (input.nextAction !== undefined)
    values.nextAction = optionalText(input.nextAction);
  if (input.nextActionDue !== undefined)
    values.nextActionDue = optionalDate(
      input.nextActionDue,
      "Next action due",
    );

  return values;
}

export function updateCompany(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateCompanyInput,
  at = new Date(),
): Company | undefined {
  const values = updateValues(input);

  return database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(company)
      .where(
        and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, id)),
      )
      .get();

    if (!current) {
      return undefined;
    }

    if (input.tags !== undefined) {
      replaceEntityTagsInTransaction(
        transaction,
        tenant,
        "company",
        id,
        input.tags,
        at,
      );
    }

    if (Object.keys(values).length === 0) {
      return current;
    }

    const updated = transaction
      .update(company)
      .set(values)
      .where(
        and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, id)),
      )
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at,
      kind: "COMPANY_UPDATED",
      entityType: "company",
      entityId: id,
      payload: { fields: Object.keys(values).sort() },
    });

    return updated;
  });
}

export function deleteCompany(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const current = transaction
      .select({ id: company.id })
      .from(company)
      .where(
        and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, id)),
      )
      .get();

    if (!current) {
      return false;
    }

    clearEntityTagsInTransaction(transaction, tenant, "company", id);

    transaction
      .delete(company)
      .where(
        and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, id)),
      )
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "COMPANY_DELETED",
      entityType: "company",
      entityId: id,
    });

    return true;
  });
}
