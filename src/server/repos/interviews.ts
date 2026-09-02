import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  formatInterviewWhen,
  interviewDueOn,
  interviewRoundTitle,
  isPendingInterviewResult,
  zonedInterviewAt,
} from "../../domain/interview";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { getWorkspaceSettings } from "../db/foundation";
import { company, interview, opportunity } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";

export type Interview = typeof interview.$inferSelect;

export type InterviewListItem = Interview & {
  companyName: string;
  role: string;
  dueOn: string | null;
  whenLabel: string;
};

export type CreateInterviewInput = {
  id?: string;
  opportunityId: string;
  kind: string;
  roundIndex?: number;
  at?: Date | string | null;
  dateOn?: string | null;
  time?: string | null;
  meetingUrl?: string | null;
  interviewer?: string | null;
  questions?: string | null;
  prepNotes?: string | null;
  performance?: string | null;
  result?: string | null;
  notes?: string | null;
  now?: Date;
};

export type UpdateInterviewInput = Partial<
  Omit<CreateInterviewInput, "id" | "opportunityId" | "now" | "roundIndex">
> & { now?: Date };

export class InterviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InterviewInputError(`${label} is required.`);
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

function parseInstant(value: Date | string): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new InterviewInputError("Interview time must be a real instant.");
    }
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new InterviewInputError("Interview time must be a real instant.");
  }
  return parsed;
}

function resolveAt(
  input: {
    at?: Date | string | null;
    dateOn?: string | null;
    time?: string | null;
  },
  timeZone: string,
): Date | null {
  if (input.at !== undefined) {
    if (input.at === null || input.at === "") {
      return null;
    }
    return parseInstant(input.at);
  }
  const dateOn = optionalText(input.dateOn);
  const time = optionalText(input.time);
  if (dateOn === null && time === null) {
    return null;
  }
  if (dateOn === null || time === null) {
    throw new InterviewInputError(
      "Add both a date and a time, or leave both empty for a pending round.",
    );
  }
  try {
    return zonedInterviewAt(timeZone, dateOn, time);
  } catch {
    throw new InterviewInputError(
      "Interview date must be YYYY-MM-DD and time HH:mm.",
    );
  }
}

function withLabels(
  row: Interview,
  companyName: string,
  role: string,
  timeZone: string,
): InterviewListItem {
  const when = formatInterviewWhen(row.at, timeZone);
  return {
    ...row,
    companyName,
    role,
    dueOn: interviewDueOn(row.at, timeZone),
    whenLabel: when.label,
  };
}

function selectInterview(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
  timeZone: string,
): InterviewListItem | undefined {
  const found = database
    .select({
      interview,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(interview)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, interview.workspaceId),
        eq(opportunity.id, interview.opportunityId),
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
      and(eq(interview.workspaceId, tenant.workspaceId), eq(interview.id, id)),
    )
    .get();
  return found
    ? withLabels(found.interview, found.companyName, found.role, timeZone)
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

function nextRoundIndex(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string,
): number {
  const row = transaction
    .select({
      max: sql<number | null>`max(${interview.roundIndex})`,
    })
    .from(interview)
    .where(
      and(
        eq(interview.workspaceId, tenant.workspaceId),
        eq(interview.opportunityId, opportunityId),
      ),
    )
    .get();
  return (row?.max ?? 0) + 1;
}

export function createInterview(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateInterviewInput,
): InterviewListItem | undefined {
  const timeZone = workspaceTimeZone(database, tenant);
  return database.transaction((transaction) => {
    if (!ownedOpportunity(transaction, tenant, input.opportunityId)) {
      return undefined;
    }
    const now = input.now ?? new Date();
    const kind = requiredText(input.kind, "Round type");
    const roundIndex =
      input.roundIndex === undefined
        ? nextRoundIndex(transaction, tenant, input.opportunityId)
        : input.roundIndex;
    if (!Number.isInteger(roundIndex) || roundIndex < 1) {
      throw new InterviewInputError("Round number must be 1 or greater.");
    }
    const id = input.id ?? randomUUID();
    try {
      transaction
        .insert(interview)
        .values({
          id,
          workspaceId: tenant.workspaceId,
          opportunityId: input.opportunityId,
          roundIndex,
          kind,
          at: resolveAt(input, timeZone),
          meetingUrl: optionalText(input.meetingUrl),
          interviewer: optionalText(input.interviewer),
          questions: optionalText(input.questions),
          prepNotes: optionalText(input.prepNotes),
          performance: optionalText(input.performance),
          result: optionalText(input.result),
          notes: optionalText(input.notes),
          createdAt: now,
        })
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) {
        throw new InterviewInputError("That round number is already used.");
      }
      throw error;
    }
    logEvent(transaction, tenant, {
      at: now,
      kind: "INTERVIEW_CREATED",
      entityType: "opportunity",
      entityId: input.opportunityId,
      payload: { interviewId: id, roundIndex, kind },
    });
    return selectInterview(transaction, tenant, id, timeZone);
  });
}

export function getInterview(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): InterviewListItem | undefined {
  return selectInterview(
    database,
    tenant,
    id,
    workspaceTimeZone(database, tenant),
  );
}

export function listInterviews(
  database: AppDatabase,
  tenant: TenantContext,
  opportunityId?: string,
): InterviewListItem[] {
  const timeZone = workspaceTimeZone(database, tenant);
  const rows = database
    .select({
      interview,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(interview)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, interview.workspaceId),
        eq(opportunity.id, interview.opportunityId),
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
            eq(interview.workspaceId, tenant.workspaceId),
            eq(interview.opportunityId, opportunityId),
          )
        : eq(interview.workspaceId, tenant.workspaceId),
    )
    .orderBy(asc(interview.roundIndex), asc(interview.id))
    .all();
  return rows.map((row) =>
    withLabels(row.interview, row.companyName, row.role, timeZone),
  );
}

export function updateInterview(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateInterviewInput,
): InterviewListItem | undefined {
  const timeZone = workspaceTimeZone(database, tenant);
  return database.transaction((transaction) => {
    const current = selectInterview(transaction, tenant, id, timeZone);
    if (!current) {
      return undefined;
    }
    const values: Partial<typeof interview.$inferInsert> = {};
    if (input.kind !== undefined) {
      values.kind = requiredText(input.kind, "Round type");
    }
    if (
      input.at !== undefined ||
      input.dateOn !== undefined ||
      input.time !== undefined
    ) {
      values.at = resolveAt(
        {
          at: input.at,
          dateOn:
            input.dateOn !== undefined ? input.dateOn : current.dueOn,
          time: input.time,
        },
        timeZone,
      );
    }
    if (input.meetingUrl !== undefined) {
      values.meetingUrl = optionalText(input.meetingUrl);
    }
    if (input.interviewer !== undefined) {
      values.interviewer = optionalText(input.interviewer);
    }
    if (input.questions !== undefined) {
      values.questions = optionalText(input.questions);
    }
    if (input.prepNotes !== undefined) {
      values.prepNotes = optionalText(input.prepNotes);
    }
    if (input.performance !== undefined) {
      values.performance = optionalText(input.performance);
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
      .update(interview)
      .set(values)
      .where(
        and(eq(interview.workspaceId, tenant.workspaceId), eq(interview.id, id)),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "INTERVIEW_UPDATED",
      entityType: "opportunity",
      entityId: current.opportunityId,
      payload: {
        interviewId: id,
        fields: Object.keys(values).sort(),
      },
    });
    return selectInterview(transaction, tenant, id, timeZone);
  });
}

export function deleteInterview(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): boolean {
  const timeZone = workspaceTimeZone(database, tenant);
  return database.transaction((transaction) => {
    const current = selectInterview(transaction, tenant, id, timeZone);
    if (!current) {
      return false;
    }
    transaction
      .delete(interview)
      .where(
        and(eq(interview.workspaceId, tenant.workspaceId), eq(interview.id, id)),
      )
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "INTERVIEW_DELETED",
      entityType: "opportunity",
      entityId: current.opportunityId,
      payload: { interviewId: id, roundIndex: current.roundIndex },
    });
    return true;
  });
}

export function listPendingInterviewDueRows(
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
      id: interview.id,
      opportunityId: interview.opportunityId,
      roundIndex: interview.roundIndex,
      kind: interview.kind,
      at: interview.at,
      result: interview.result,
      companyName: company.name,
      role: opportunity.role,
    })
    .from(interview)
    .innerJoin(
      opportunity,
      and(
        eq(opportunity.workspaceId, interview.workspaceId),
        eq(opportunity.id, interview.opportunityId),
      ),
    )
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(eq(interview.workspaceId, tenant.workspaceId))
    .all();

  const due: Array<{
    id: string;
    opportunityId: string;
    title: string;
    dueOn: string;
    entityLabel: string;
  }> = [];
  for (const row of rows) {
    if (!isPendingInterviewResult(row.result)) {
      continue;
    }
    const dueOn = interviewDueOn(row.at, timeZone);
    if (dueOn === null) {
      continue;
    }
    due.push({
      id: row.id,
      opportunityId: row.opportunityId,
      title: interviewRoundTitle(row.roundIndex, row.kind),
      dueOn,
      entityLabel: `${row.companyName} ${row.role}`.trim(),
    });
  }
  return due;
}

export function countInterviewsOn(
  database: AppDatabase,
  tenant: TenantContext,
  asOfOn: string,
  timeZone: string,
): number {
  const rows = database
    .select({ at: interview.at })
    .from(interview)
    .where(eq(interview.workspaceId, tenant.workspaceId))
    .all();
  return rows.filter((row) => interviewDueOn(row.at, timeZone) === asOfOn)
    .length;
}
