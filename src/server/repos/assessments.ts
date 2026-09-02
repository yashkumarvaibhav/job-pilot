import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  DEFAULT_ASSESSMENT_STATUS,
  assessmentDueOn,
  derivedAssessmentTitle,
  isAssessmentStatus,
  isOpenAssessmentStatus,
  zonedAssessmentDueAt,
  type AssessmentStatus,
} from "../../domain/assessment";
import { formatInterviewWhen } from "../../domain/interview";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { getWorkspaceSettings } from "../db/foundation";
import {
  application,
  assessment,
  company,
  opportunity,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";

export type Assessment = typeof assessment.$inferSelect;

export type AssessmentListItem = Assessment & {
  companyName: string;
  role: string;
  dueOn: string | null;
  whenLabel: string;
  windowLabel: string;
};

export type CreateAssessmentInput = {
  id?: string;
  opportunityId: string;
  applicationId?: string | null;
  kind: string;
  platform?: string | null;
  invitedAt?: Date | string | null;
  windowOpensAt?: Date | string | null;
  windowOpensDateOn?: string | null;
  windowOpensTime?: string | null;
  dueAt?: Date | string | null;
  dateOn?: string | null;
  time?: string | null;
  durationMinutes?: number | string | null;
  status?: AssessmentStatus | string | null;
  result?: string | null;
  notes?: string | null;
  now?: Date;
};

export type UpdateAssessmentInput = Partial<
  Omit<CreateAssessmentInput, "id" | "opportunityId" | "now">
> & { now?: Date };

export class AssessmentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssessmentInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new AssessmentInputError(`${label} is required.`);
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

function workspaceTimeZone(
  database: AppDatabase,
  tenant: TenantContext,
): string {
  return (
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE
  );
}

function parseInstant(value: Date | string, label: string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new AssessmentInputError(`${label} must be a real instant.`);
    }
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new AssessmentInputError(`${label} must be a real instant.`);
  }
  return parsed;
}

function resolveClock(
  input: {
    at?: Date | string | null;
    dateOn?: string | null;
    time?: string | null;
  },
  timeZone: string,
  label: string,
): Date | null {
  if (input.at !== undefined) {
    if (input.at === null || input.at === "") {
      return null;
    }
    return parseInstant(input.at, label);
  }
  const dateOn = optionalText(input.dateOn);
  const time = optionalText(input.time);
  if (dateOn === null && time === null) {
    return null;
  }
  if (dateOn === null || time === null) {
    throw new AssessmentInputError(
      `Add both a date and a time for the ${label.toLowerCase()}, or leave both empty.`,
    );
  }
  try {
    return zonedAssessmentDueAt(timeZone, dateOn, time);
  } catch {
    throw new AssessmentInputError(
      `${label} must be YYYY-MM-DD and time HH:mm.`,
    );
  }
}

function parseDuration(
  value: number | string | null | undefined,
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AssessmentInputError(
      "Duration must be a whole number of minutes greater than zero.",
    );
  }
  return parsed;
}

function validStatus(value: unknown): AssessmentStatus {
  if (value == null || value === "") {
    return DEFAULT_ASSESSMENT_STATUS;
  }
  if (!isAssessmentStatus(value)) {
    throw new AssessmentInputError("Choose a valid assessment status.");
  }
  return value;
}

function withLabels(
  row: Assessment,
  companyName: string,
  role: string,
  timeZone: string,
): AssessmentListItem {
  const when = formatInterviewWhen(row.dueAt, timeZone);
  const window = formatInterviewWhen(row.windowOpensAt, timeZone);
  return {
    ...row,
    companyName,
    role,
    dueOn: assessmentDueOn(row.dueAt, timeZone),
    whenLabel: when.label,
    windowLabel: window.label,
  };
}

function selectAssessment(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
  timeZone: string,
): AssessmentListItem | undefined {
  const found = database
    .select({
      assessment,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(assessment)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, assessment.workspaceId),
        eq(opportunity.id, assessment.opportunityId),
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
      and(eq(assessment.workspaceId, tenant.workspaceId), eq(assessment.id, id)),
    )
    .get();
  return found
    ? withLabels(found.assessment, found.companyName, found.role, timeZone)
    : undefined;
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

function ownedApplicationForOpportunity(
  transaction: AppTransaction,
  tenant: TenantContext,
  applicationId: string,
  opportunityId: string,
) {
  return transaction
    .select({
      id: application.id,
      opportunityId: application.opportunityId,
    })
    .from(application)
    .where(
      and(
        eq(application.workspaceId, tenant.workspaceId),
        eq(application.id, applicationId),
      ),
    )
    .get()?.opportunityId === opportunityId
    ? applicationId
    : undefined;
}

function resolveApplicationId(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
  applicationId: string | null | undefined,
  provided: boolean,
): string | null | undefined {
  if (!provided) {
    return undefined;
  }
  const normalized = optionalText(applicationId);
  if (normalized === null) {
    return null;
  }
  if (
    !ownedApplicationForOpportunity(
      transaction,
      tenant,
      normalized,
      opportunityId,
    )
  ) {
    throw new AssessmentInputError(
      "Link an application that belongs to this opportunity.",
    );
  }
  return normalized;
}

export function createAssessment(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateAssessmentInput,
): AssessmentListItem | undefined {
  const timeZone = workspaceTimeZone(database, tenant);
  return database.transaction((transaction) => {
    if (!ownedOpportunity(transaction, tenant, input.opportunityId)) {
      return undefined;
    }
    const now = input.now ?? new Date();
    const kind = requiredText(input.kind, "Kind");
    const status = validStatus(input.status ?? DEFAULT_ASSESSMENT_STATUS);
    const applicationId = resolveApplicationId(
      transaction,
      tenant,
      input.opportunityId,
      input.applicationId,
      input.applicationId !== undefined,
    );
    const id = input.id ?? randomUUID();
    transaction
      .insert(assessment)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        opportunityId: input.opportunityId,
        applicationId: applicationId ?? null,
        kind,
        platform: optionalText(input.platform),
        invitedAt:
          input.invitedAt !== undefined
            ? input.invitedAt === null || input.invitedAt === ""
              ? now
              : parseInstant(input.invitedAt, "Invited at")
            : now,
        windowOpensAt: resolveClock(
          {
            at: input.windowOpensAt,
            dateOn: input.windowOpensDateOn,
            time: input.windowOpensTime,
          },
          timeZone,
          "Window",
        ),
        dueAt: resolveClock(
          {
            at: input.dueAt,
            dateOn: input.dateOn,
            time: input.time,
          },
          timeZone,
          "Deadline",
        ),
        durationMinutes: parseDuration(input.durationMinutes),
        status,
        result: optionalText(input.result),
        notes: optionalText(input.notes),
        createdAt: now,
      })
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "ASSESSMENT_INVITED",
      entityType: "opportunity",
      entityId: input.opportunityId,
      payload: { assessmentId: id, status, kind },
    });
    if (status === "completed") {
      logEvent(transaction, tenant, {
        at: now,
        kind: "ASSESSMENT_COMPLETED",
        entityType: "opportunity",
        entityId: input.opportunityId,
        payload: { assessmentId: id },
      });
    }
    return selectAssessment(transaction, tenant, id, timeZone);
  });
}

export function getAssessment(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): AssessmentListItem | undefined {
  return selectAssessment(
    database,
    tenant,
    id,
    workspaceTimeZone(database, tenant),
  );
}

export function listAssessments(
  database: AppDatabase,
  tenant: TenantContext,
  opportunityId?: string,
): AssessmentListItem[] {
  const timeZone = workspaceTimeZone(database, tenant);
  const rows = database
    .select({
      assessment,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(assessment)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, assessment.workspaceId),
        eq(opportunity.id, assessment.opportunityId),
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
      opportunityId
        ? and(
            eq(assessment.workspaceId, tenant.workspaceId),
            eq(assessment.opportunityId, opportunityId),
          )
        : eq(assessment.workspaceId, tenant.workspaceId),
    )
    .orderBy(
      asc(sql`case when ${assessment.dueAt} is null then 1 else 0 end`),
      asc(assessment.dueAt),
      asc(assessment.createdAt),
      asc(assessment.id),
    )
    .all();
  return rows.map(({ assessment: row, companyName, role }) =>
    withLabels(row, companyName, role, timeZone),
  );
}

export function updateAssessment(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateAssessmentInput,
): AssessmentListItem | undefined {
  const timeZone = workspaceTimeZone(database, tenant);
  return database.transaction((transaction) => {
    const current = selectAssessment(transaction, tenant, id, timeZone);
    if (!current) {
      return undefined;
    }
    const values: Partial<typeof assessment.$inferInsert> = {};
    if (input.kind !== undefined) {
      values.kind = requiredText(input.kind, "Kind");
    }
    if (input.platform !== undefined) {
      values.platform = optionalText(input.platform);
    }
    if (input.applicationId !== undefined) {
      values.applicationId =
        resolveApplicationId(
          transaction,
          tenant,
          current.opportunityId,
          input.applicationId,
          true,
        ) ?? null;
    }
    if (
      input.dueAt !== undefined ||
      input.dateOn !== undefined ||
      input.time !== undefined
    ) {
      values.dueAt = resolveClock(
        {
          at: input.dueAt,
          dateOn: input.dateOn,
          time: input.time,
        },
        timeZone,
        "Deadline",
      );
    }
    if (
      input.windowOpensAt !== undefined ||
      input.windowOpensDateOn !== undefined ||
      input.windowOpensTime !== undefined
    ) {
      values.windowOpensAt = resolveClock(
        {
          at: input.windowOpensAt,
          dateOn: input.windowOpensDateOn,
          time: input.windowOpensTime,
        },
        timeZone,
        "Window",
      );
    }
    if (input.invitedAt !== undefined) {
      values.invitedAt =
        input.invitedAt === null || input.invitedAt === ""
          ? current.invitedAt
          : parseInstant(input.invitedAt, "Invited at");
    }
    if (input.durationMinutes !== undefined) {
      values.durationMinutes = parseDuration(input.durationMinutes);
    }
    if (input.status !== undefined) {
      values.status = validStatus(input.status);
    }
    if (input.result !== undefined) {
      values.result = optionalText(input.result);
    }
    if (input.notes !== undefined) {
      values.notes = optionalText(input.notes);
    }
    if (Object.keys(values).length === 0) {
      return current;
    }
    const now = input.now ?? new Date();
    transaction
      .update(assessment)
      .set(values)
      .where(
        and(
          eq(assessment.workspaceId, tenant.workspaceId),
          eq(assessment.id, id),
        ),
      )
      .run();
    if (values.status === "completed" && current.status !== "completed") {
      logEvent(transaction, tenant, {
        at: now,
        kind: "ASSESSMENT_COMPLETED",
        entityType: "opportunity",
        entityId: current.opportunityId,
        payload: { assessmentId: id },
      });
    }
    return selectAssessment(transaction, tenant, id, timeZone);
  });
}

export function deleteAssessment(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): boolean {
  return database.transaction((transaction) => {
    const timeZone = workspaceTimeZone(transaction, tenant);
    const current = selectAssessment(transaction, tenant, id, timeZone);
    if (!current) {
      return false;
    }
    transaction
      .delete(assessment)
      .where(
        and(
          eq(assessment.workspaceId, tenant.workspaceId),
          eq(assessment.id, id),
        ),
      )
      .run();
    return true;
  });
}

export function listOpenAssessmentDueRows(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  timeZone: string,
): Array<{
  id: string;
  opportunityId: string;
  title: string;
  dueOn: string;
  entityLabel: string;
}> {
  const rows = database
    .select({
      id: assessment.id,
      opportunityId: assessment.opportunityId,
      status: assessment.status,
      dueAt: assessment.dueAt,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(assessment)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, assessment.workspaceId),
        eq(opportunity.id, assessment.opportunityId),
      ),
    )
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(eq(assessment.workspaceId, tenant.workspaceId))
    .all();

  const due: Array<{
    id: string;
    opportunityId: string;
    title: string;
    dueOn: string;
    entityLabel: string;
  }> = [];
  for (const row of rows) {
    if (!isOpenAssessmentStatus(row.status)) {
      continue;
    }
    const dueOn = assessmentDueOn(row.dueAt, timeZone);
    if (dueOn === null) {
      continue;
    }
    due.push({
      id: row.id,
      opportunityId: row.opportunityId,
      title: derivedAssessmentTitle(row.companyName),
      dueOn,
      entityLabel: row.companyName,
    });
  }
  return due;
}
