import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company } from "../db/schema";
import type { TenantContext } from "../db/tenant";

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
      createdAt: now,
    })
    .returning()
    .get();

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
