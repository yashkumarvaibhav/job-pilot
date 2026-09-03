export const EXPORT_JSON_LABEL = "Export JSON";
export const EXPORT_JOBS_CSV_LABEL = "Export jobs CSV";
export const EXPORT_CONTACTS_CSV_LABEL = "Export contacts CSV";
export const EXPORT_APPLICATIONS_CSV_LABEL = "Export applications CSV";
export const EXPORT_ACTIVITY_CSV_LABEL = "Export activity CSV";
export const EXPORT_HELP =
  "JSON is this workspace's companies, contacts, jobs, applications, referrals, safe Gmail account metadata, Job Inbox threads and activity. Each CSV is one table with a header row. Password hashes and account tokens are not included.";

export const EXPORT_FORMATS = ["json", "csv"] as const;
export const EXPORT_SETS = [
  "all",
  "jobs",
  "contacts",
  "applications",
  "activity",
] as const;
export const EXPORT_CSV_SETS = [
  "jobs",
  "contacts",
  "applications",
  "activity",
] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportSet = (typeof EXPORT_SETS)[number];
export type ExportCsvSet = (typeof EXPORT_CSV_SETS)[number];

export type ExportQuery = {
  format: ExportFormat;
  set: ExportSet;
};

const SECRET_KEYS = new Set([
  "workspaceid",
  "owneruserid",
  "userid",
  "passwordhash",
  "password_hash",
  "app_password",
  "app_password_hash",
  "tokendigest",
  "token_digest",
  "refreshtoken",
  "accesstoken",
  "sessiontoken",
  "session",
  "valuenormalized",
]);

export class ExportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportInputError";
  }
}

function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

function isExportSet(value: string): value is ExportSet {
  return (EXPORT_SETS as readonly string[]).includes(value);
}

function isCsvSet(value: ExportSet): value is ExportCsvSet {
  return (EXPORT_CSV_SETS as readonly string[]).includes(value);
}

export function parseExportQuery(search: URLSearchParams): ExportQuery {
  const format = search.get("format")?.trim().toLowerCase() ?? "";
  const set = search.get("set")?.trim().toLowerCase() ?? "";

  if (!isExportFormat(format)) {
    throw new ExportInputError("Choose JSON or CSV.");
  }
  if (!isExportSet(set)) {
    throw new ExportInputError(
      "Choose what to export: all, jobs, contacts, applications, or activity.",
    );
  }
  if (format === "csv" && !isCsvSet(set)) {
    throw new ExportInputError(
      "CSV export needs a table: jobs, contacts, applications, or activity.",
    );
  }

  return { format, set };
}

export function exportFilename(format: ExportFormat, set: ExportSet): string {
  if (format === "json" && set === "all") {
    return "job-pilot.json";
  }
  return `job-pilot-${set}.${format}`;
}

function isSecretKey(key: string): boolean {
  const normalized = key.replaceAll("_", "").toLowerCase();
  if (SECRET_KEYS.has(key.toLowerCase()) || SECRET_KEYS.has(normalized)) {
    return true;
  }
  return /password|token|secret/i.test(key);
}

function cellText(value: string | number | boolean | null | undefined): string {
  if (value == null) {
    return "";
  }
  return String(value);
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function serializeCsv(
  headers: readonly string[],
  rows: ReadonlyArray<
    ReadonlyArray<string | number | boolean | null | undefined>
  >,
): string {
  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((row) =>
      headers.map((_, index) => csvCell(cellText(row[index]))).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function omitExportSecrets(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(omitExportSecrets);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !isSecretKey(key))
      .map(([key, nested]) => [key, omitExportSecrets(nested)]);
    return Object.fromEntries(entries);
  }
  return value;
}
