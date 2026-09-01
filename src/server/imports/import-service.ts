import { and, eq } from "drizzle-orm";

import {
  CsvImportError,
  parseCsv,
  type CsvDocument,
  type CsvRow,
} from "../../domain/csv-import";
import { isContactRelationship, isNetworkingStatus } from "../../domain/contact";
import {
  isOpportunityBucket,
  isOpportunitySelectableStage,
} from "../../domain/opportunity";
import { normalizeEmail } from "../auth/email";
import type { AppDatabase } from "../db/client";
import { company, contactMethod, opportunity } from "../db/schema";
import type { TenantContext } from "../db/tenant";

export const IMPORT_ENTITY_SETS = [
  "companies",
  "contacts",
  "opportunities",
] as const;
export type ImportEntitySet = (typeof IMPORT_ENTITY_SETS)[number];

const FIELDS = {
  companies: [
    "name",
    "website",
    "careersUrl",
    "industry",
    "type",
    "locations",
    "target",
    "notes",
  ],
  contacts: [
    "name",
    "company",
    "designation",
    "email",
    "relationship",
    "source",
    "location",
    "notes",
    "networkingStatus",
    "nextAction",
    "followUpOn",
  ],
  opportunities: [
    "company",
    "role",
    "jobId",
    "url",
    "location",
    "workMode",
    "employmentType",
    "experienceRequirement",
    "source",
    "discoveredOn",
    "postedOn",
    "deadlineOn",
    "compensation",
    "priority",
    "interestScore",
    "eligibility",
    "referralPreferred",
    "jdSnapshot",
    "notes",
    "bucket",
    "stage",
    "nextAction",
  ],
} as const satisfies Record<ImportEntitySet, readonly string[]>;

const REQUIRED_FIELDS: Record<ImportEntitySet, readonly string[]> = {
  companies: ["name"],
  contacts: ["name"],
  opportunities: ["company", "role"],
};

export type ImportRequest = {
  entitySet: ImportEntitySet;
  dryRun: boolean;
  csv: string;
  mapping: Record<string, string>;
  createMissingCompanies: boolean;
};

export type ImportReportRow = {
  line: number;
  status: "would-create" | "would-warn" | "would-skip";
  reason: string;
};

export type ImportPlan = {
  entitySet: ImportEntitySet;
  dryRun: true;
  duplicateCheck: string;
  summary: {
    wouldCreate: number;
    wouldWarn: number;
    wouldSkip: number;
  };
  rows: ImportReportRow[];
};

export class ImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportInputError";
  }
}

export function importFields(entitySet: ImportEntitySet): readonly string[] {
  return FIELDS[entitySet];
}

function isEntitySet(value: unknown): value is ImportEntitySet {
  return typeof value === "string" && IMPORT_ENTITY_SETS.includes(value as ImportEntitySet);
}

export function readImportBody(body: unknown): ImportRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ImportInputError("Enter valid import details.");
  }
  const value = body as Record<string, unknown>;
  const allowed = new Set([
    "entitySet",
    "dryRun",
    "csv",
    "mapping",
    "createMissingCompanies",
  ]);
  if (!Object.keys(value).every((key) => allowed.has(key))) {
    throw new ImportInputError("Enter valid import details.");
  }
  if (
    !isEntitySet(value.entitySet) ||
    typeof value.dryRun !== "boolean" ||
    typeof value.csv !== "string" ||
    typeof value.mapping !== "object" ||
    value.mapping === null ||
    Array.isArray(value.mapping) ||
    ("createMissingCompanies" in value &&
      typeof value.createMissingCompanies !== "boolean")
  ) {
    throw new ImportInputError("Enter valid import details.");
  }

  const mapping = value.mapping as Record<string, unknown>;
  const allowedFields = new Set<string>(FIELDS[value.entitySet]);
  if (
    !Object.keys(mapping).every((field) => allowedFields.has(field)) ||
    !Object.values(mapping).every(
      (header) => typeof header === "string" && header.trim().length > 0,
    )
  ) {
    throw new ImportInputError("Choose valid CSV column mappings.");
  }
  const normalizedMapping = Object.fromEntries(
    Object.entries(mapping).map(([field, header]) => [field, (header as string).trim()]),
  );
  if (new Set(Object.values(normalizedMapping)).size !== Object.keys(normalizedMapping).length) {
    throw new ImportInputError("Map each CSV column only once.");
  }
  for (const field of REQUIRED_FIELDS[value.entitySet]) {
    if (!(field in normalizedMapping)) {
      throw new ImportInputError(`Map the required ${field} field.`);
    }
  }

  return {
    entitySet: value.entitySet,
    dryRun: value.dryRun,
    csv: value.csv,
    mapping: normalizedMapping,
    createMissingCompanies: value.createMissingCompanies === true,
  };
}

function mapped(
  document: CsvDocument,
  row: CsvRow,
  mapping: Record<string, string>,
  field: string,
): string {
  const header = mapping[field];
  if (!header) return "";
  return row.values[document.headers.indexOf(header)]?.trim() ?? "";
}

function validHttpUrl(value: string): boolean {
  if (value.length === 0) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (value.length === 0) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function booleanValue(value: string): boolean | null {
  if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
  if (["false", "no", "0", ""].includes(value.toLowerCase())) return false;
  return null;
}

function report(line: number, status: ImportReportRow["status"], reason: string) {
  return { line, status, reason };
}

function invalidWidth(document: CsvDocument, row: CsvRow): ImportReportRow | null {
  return row.values.length === document.headers.length
    ? null
    : report(
        row.line,
        "would-skip",
        `Expected ${document.headers.length} columns but found ${row.values.length}.`,
      );
}

function validateMappedHeaders(document: CsvDocument, request: ImportRequest) {
  for (const header of Object.values(request.mapping)) {
    if (!document.headers.includes(header)) {
      throw new ImportInputError(`Mapped CSV column not found: "${header}".`);
    }
  }
}

function planCompany(
  database: AppDatabase,
  tenant: TenantContext,
  document: CsvDocument,
  row: CsvRow,
  mapping: Record<string, string>,
): ImportReportRow {
  const width = invalidWidth(document, row);
  if (width) return width;
  const name = mapped(document, row, mapping, "name");
  if (!name) return report(row.line, "would-skip", "Company name is required.");
  for (const [field, label] of [
    ["website", "Website"],
    ["careersUrl", "Careers URL"],
  ] as const) {
    if (!validHttpUrl(mapped(document, row, mapping, field))) {
      return report(row.line, "would-skip", `${label} must use http or https.`);
    }
  }
  if (mapping.target && booleanValue(mapped(document, row, mapping, "target")) === null) {
    return report(row.line, "would-skip", "Target must be yes or no.");
  }
  const duplicate = database
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.workspaceId, tenant.workspaceId), eq(company.name, name)))
    .get();
  return duplicate
    ? report(row.line, "would-skip", `Exact company name already exists: "${name}".`)
    : report(row.line, "would-create", "Ready to import.");
}

function companyByName(
  database: AppDatabase,
  tenant: TenantContext,
  name: string,
) {
  return database
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.workspaceId, tenant.workspaceId), eq(company.name, name)))
    .get();
}

function planContact(
  database: AppDatabase,
  tenant: TenantContext,
  document: CsvDocument,
  row: CsvRow,
  request: ImportRequest,
): ImportReportRow {
  const width = invalidWidth(document, row);
  if (width) return width;
  const name = mapped(document, row, request.mapping, "name");
  if (!name) return report(row.line, "would-skip", "Contact name is required.");
  const email = mapped(document, row, request.mapping, "email");
  const normalizedEmail = email ? normalizeEmail(email) : null;
  if (email && !normalizedEmail) {
    return report(row.line, "would-skip", "Email address is invalid.");
  }
  if (normalizedEmail) {
    const duplicate = database
      .select({ id: contactMethod.id })
      .from(contactMethod)
      .where(
        and(
          eq(contactMethod.workspaceId, tenant.workspaceId),
          eq(contactMethod.kind, "email"),
          eq(contactMethod.valueNormalized, normalizedEmail),
        ),
      )
      .get();
    if (duplicate) {
      return report(row.line, "would-skip", `Exact contact email already exists: "${normalizedEmail}".`);
    }
  }
  const relationship = mapped(document, row, request.mapping, "relationship");
  if (relationship && !isContactRelationship(relationship)) {
    return report(row.line, "would-skip", "Relationship value is invalid.");
  }
  const status = mapped(document, row, request.mapping, "networkingStatus");
  if (status && !isNetworkingStatus(status)) {
    return report(row.line, "would-skip", "Networking status value is invalid.");
  }
  const followUpOn = mapped(document, row, request.mapping, "followUpOn");
  if (!validDate(followUpOn)) {
    return report(row.line, "would-skip", "Follow-up date must use YYYY-MM-DD.");
  }
  const companyName = mapped(document, row, request.mapping, "company");
  if (companyName && !companyByName(database, tenant, companyName)) {
    return request.createMissingCompanies
      ? report(row.line, "would-warn", `Company "${companyName}" will be created with this contact.`)
      : report(row.line, "would-skip", `Company not found: "${companyName}".`);
  }
  return email
    ? report(row.line, "would-create", "Ready to import.")
    : report(row.line, "would-warn", "Ready to import; no email was mapped, so exact email duplicate checking cannot run.");
}

function planOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  document: CsvDocument,
  row: CsvRow,
  request: ImportRequest,
): ImportReportRow {
  const width = invalidWidth(document, row);
  if (width) return width;
  const companyName = mapped(document, row, request.mapping, "company");
  const role = mapped(document, row, request.mapping, "role");
  if (!companyName) return report(row.line, "would-skip", "Company is required.");
  if (!role) return report(row.line, "would-skip", "Role is required.");
  if (!validHttpUrl(mapped(document, row, request.mapping, "url"))) {
    return report(row.line, "would-skip", "Job URL must use http or https.");
  }
  for (const [field, label] of [
    ["discoveredOn", "Date discovered"],
    ["postedOn", "Posting date"],
    ["deadlineOn", "Deadline"],
  ] as const) {
    if (!validDate(mapped(document, row, request.mapping, field))) {
      return report(row.line, "would-skip", `${label} must use YYYY-MM-DD.`);
    }
  }
  const interestScore = mapped(document, row, request.mapping, "interestScore");
  if (interestScore && !Number.isSafeInteger(Number(interestScore))) {
    return report(row.line, "would-skip", "Interest score must be a whole number.");
  }
  const referralPreferred = mapped(document, row, request.mapping, "referralPreferred");
  if (request.mapping.referralPreferred && booleanValue(referralPreferred) === null) {
    return report(row.line, "would-skip", "Referral preferred must be yes or no.");
  }
  const bucket = mapped(document, row, request.mapping, "bucket");
  if (bucket && !isOpportunityBucket(bucket)) {
    return report(row.line, "would-skip", "Bucket must be saved or active.");
  }
  const stage = mapped(document, row, request.mapping, "stage");
  if (stage && !isOpportunitySelectableStage(stage)) {
    return report(row.line, "would-skip", "Stage value is invalid.");
  }
  const foundCompany = companyByName(database, tenant, companyName);
  if (!foundCompany) {
    return request.createMissingCompanies
      ? report(row.line, "would-warn", `Company "${companyName}" will be created with this opportunity.`)
      : report(row.line, "would-skip", `Company not found: "${companyName}".`);
  }
  const jobId = mapped(document, row, request.mapping, "jobId");
  if (jobId) {
    const duplicate = database
      .select({ id: opportunity.id })
      .from(opportunity)
      .where(
        and(
          eq(opportunity.workspaceId, tenant.workspaceId),
          eq(opportunity.companyId, foundCompany.id),
          eq(opportunity.jobId, jobId),
        ),
      )
      .get();
    if (duplicate) {
      return report(row.line, "would-skip", `Exact company and job ID already exist: "${companyName}" / "${jobId}".`);
    }
    return report(row.line, "would-create", "Ready to import.");
  }
  return report(row.line, "would-warn", "Ready to import; no job ID was mapped, so exact company and job ID duplicate checking cannot run.");
}

export function planImport(
  database: AppDatabase,
  tenant: TenantContext,
  request: ImportRequest,
): ImportPlan {
  if (!request.dryRun) {
    throw new ImportInputError("Run a dry run before applying an import.");
  }
  let document: CsvDocument;
  try {
    document = parseCsv(request.csv);
  } catch (error) {
    if (error instanceof CsvImportError) throw new ImportInputError(error.message);
    throw error;
  }
  validateMappedHeaders(document, request);

  const rows = document.rows.map((row) => {
    if (request.entitySet === "companies") {
      return planCompany(database, tenant, document, row, request.mapping);
    }
    if (request.entitySet === "contacts") {
      return planContact(database, tenant, document, row, request);
    }
    return planOpportunity(database, tenant, document, row, request);
  });
  const summary = { wouldCreate: 0, wouldWarn: 0, wouldSkip: 0 };
  for (const row of rows) {
    if (row.status === "would-create") summary.wouldCreate += 1;
    if (row.status === "would-warn") summary.wouldWarn += 1;
    if (row.status === "would-skip") summary.wouldSkip += 1;
  }
  const duplicateCheck =
    request.entitySet === "companies"
      ? "Exact company name within your workspace."
      : request.entitySet === "contacts"
        ? "Exact normalized contact email within your workspace; rows without email are warned."
        : "Exact company and job ID within your workspace; rows without job ID are warned.";
  return { entitySet: request.entitySet, dryRun: true, duplicateCheck, summary, rows };
}
