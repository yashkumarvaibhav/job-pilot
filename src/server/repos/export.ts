import { eq } from "drizzle-orm";

import { calendarDateInZone } from "../../domain/referral";
import { formatClockMinutes } from "../../domain/settings";
import {
  omitExportSecrets,
  parseExportQuery,
  serializeCsv,
  type ExportCsvSet,
  type ExportQuery,
} from "../../domain/export";
import type { AppDatabase } from "../db/client";
import { contactMethod } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { listActivity } from "./activity";
import { listApplications } from "./applications";
import { listCompanies } from "./companies";
import { listContacts, type ContactMethod } from "./contacts";
import { listOpportunities } from "./opportunities";
import { listReferrals } from "./referrals";
import { readWorkspaceSettings } from "./settings";

export type WorkspaceExport = {
  filename: string;
  contentType: string;
  body: string;
};

type ExportContact = ReturnType<typeof listContacts>[number] & {
  email: string;
  methods: Array<Pick<ContactMethod, "kind" | "value" | "isPrimary">>;
};

function iso(value: Date | string | null | undefined): string {
  if (value == null) {
    return "";
  }
  return value instanceof Date ? value.toISOString() : value;
}

function primaryEmail(methods: ContactMethod[]): string {
  const emails = methods.filter((method) => method.kind === "email");
  return emails.find((method) => method.isPrimary)?.value ?? emails[0]?.value ?? "";
}

function loadMethods(
  database: AppDatabase,
  tenant: TenantContext,
): Map<string, ContactMethod[]> {
  const grouped = new Map<string, ContactMethod[]>();
  const rows = database
    .select()
    .from(contactMethod)
    .where(eq(contactMethod.workspaceId, tenant.workspaceId))
    .all();
  for (const row of rows) {
    const current = grouped.get(row.contactId) ?? [];
    current.push(row);
    grouped.set(row.contactId, current);
  }
  return grouped;
}

function exportContacts(database: AppDatabase, tenant: TenantContext): ExportContact[] {
  const methodsByContact = loadMethods(database, tenant);
  return listContacts(database, tenant).map((row) => {
    const methods = methodsByContact.get(row.id) ?? [];
    return {
      ...row,
      email: primaryEmail(methods),
      methods: methods.map((method) => ({
        kind: method.kind,
        value: method.value,
        isPrimary: method.isPrimary,
      })),
    };
  });
}

function exportSettings(database: AppDatabase, tenant: TenantContext) {
  const view = readWorkspaceSettings(database, tenant);
  return {
    displayName: view.displayName,
    university: view.university,
    timezone: view.timezone,
    quietStart:
      view.quietStart == null ? null : formatClockMinutes(view.quietStart),
    quietEnd: view.quietEnd == null ? null : formatClockMinutes(view.quietEnd),
  };
}

function snapshot(
  database: AppDatabase,
  tenant: TenantContext,
  now: Date,
) {
  const settings = exportSettings(database, tenant);
  return {
    exportedAt: now.toISOString(),
    settings,
    companies: listCompanies(database, tenant),
    contacts: exportContacts(database, tenant),
    opportunities: listOpportunities(database, tenant, "all"),
    applications: listApplications(database, tenant),
    referrals: listReferrals(database, tenant, {
      asOfOn: calendarDateInZone(settings.timezone, now),
    }),
    activity: listActivity(database, tenant, { timeZone: settings.timezone }),
  };
}

function jsonBody(value: unknown): string {
  return `${JSON.stringify(omitExportSecrets(value), null, 2)}\n`;
}

function csvForSet(
  set: ExportCsvSet,
  data: ReturnType<typeof snapshot>,
): string {
  if (set === "contacts") {
    return serializeCsv(
      ["Name", "Email", "Company", "Designation", "Relationship", "Status", "Id"],
      data.contacts.map((row) => [
        row.name,
        row.email,
        row.companyName,
        row.designation,
        row.relationship,
        row.networkingStatus,
        row.id,
      ]),
    );
  }
  if (set === "jobs") {
    return serializeCsv(
      [
        "Company",
        "Role",
        "Job ID",
        "URL",
        "Location",
        "Bucket",
        "Stage",
        "Deadline",
        "Id",
      ],
      data.opportunities.map((row) => [
        row.companyName,
        row.role,
        row.jobId,
        row.url,
        row.location,
        row.bucket,
        row.stage,
        row.deadlineOn,
        row.id,
      ]),
    );
  }
  if (set === "applications") {
    return serializeCsv(
      ["Company", "Role", "Portal", "Applied", "Stage", "Id"],
      data.applications.map((row) => [
        row.companyName,
        row.role,
        row.portal,
        row.appliedOn,
        row.stage,
        row.id,
      ]),
    );
  }
  return serializeCsv(
    ["When", "Kind", "Headline", "Entity", "Id"],
    data.activity.map((row) => [
      iso(row.at),
      row.kind,
      row.headline,
      row.entityType,
      row.id,
    ]),
  );
}

function jsonForQuery(query: ExportQuery, data: ReturnType<typeof snapshot>): unknown {
  if (query.set === "all") {
    return data;
  }
  if (query.set === "jobs") {
    return { exportedAt: data.exportedAt, jobs: data.opportunities };
  }
  if (query.set === "contacts") {
    return { exportedAt: data.exportedAt, contacts: data.contacts };
  }
  if (query.set === "applications") {
    return { exportedAt: data.exportedAt, applications: data.applications };
  }
  return { exportedAt: data.exportedAt, activity: data.activity };
}

export function buildWorkspaceExport(
  database: AppDatabase,
  tenant: TenantContext,
  query: ExportQuery,
  now = new Date(),
): WorkspaceExport {
  const data = snapshot(database, tenant, now);
  if (query.format === "csv") {
    return {
      filename: `job-pilot-${query.set}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csvForSet(query.set as ExportCsvSet, data),
    };
  }
  return {
    filename: query.set === "all" ? "job-pilot.json" : `job-pilot-${query.set}.json`,
    contentType: "application/json; charset=utf-8",
    body: jsonBody(jsonForQuery(query, data)),
  };
}

export function exportFromSearchParams(
  database: AppDatabase,
  tenant: TenantContext,
  search: URLSearchParams,
  now = new Date(),
): WorkspaceExport {
  return buildWorkspaceExport(database, tenant, parseExportQuery(search), now);
}
