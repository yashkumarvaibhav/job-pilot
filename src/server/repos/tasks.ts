import { randomUUID } from "node:crypto";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";

import {
  derivedDueItemTitle,
  dueSourceKey,
  parseDueSourceKey,
  type DueSourceKind,
} from "../../domain/due-source";
import { isNetworkingTerminalStatus } from "../../domain/contact";
import { isReferralTerminalStage } from "../../domain/referral";
import {
  interviewDueOn,
  interviewRoundTitle,
} from "../../domain/interview";
import {
  assessmentDueOn,
  derivedAssessmentTitle,
  isOpenAssessmentStatus,
} from "../../domain/assessment";
import { isOpenOfferDeadline } from "../../domain/application";
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_SOURCE,
  DEFAULT_TASK_STATUS,
  isTaskLinkType,
  isTaskPriority,
  isTaskSource,
  isTaskStatus,
  isTerminalTaskStatus,
  type TaskLinkType,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from "../../domain/task";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { getWorkspaceSettings } from "../db/foundation";
import {
  application,
  assessment,
  company,
  contact,
  interview,
  notification,
  opportunity,
  referralRequest,
  task,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";
import { listPendingInterviewDueRows } from "./interviews";
import { listOpenAssessmentDueRows } from "./assessments";
import { listOpenOfferDeadlineDueRows } from "./applications";
import { listDueSequenceItemsInTransaction } from "./sequences";

export type Task = typeof task.$inferSelect;

export type TaskListItem = Task & {
  entityLabel: string | null;
};

export type DueItem = {
  sourceKey: string;
  origin: "derived" | "task";
  title: string;
  dueOn: string | null;
  entityType: TaskLinkType | null;
  entityId: string | null;
  entityLabel: string;
  taskId: string | null;
  derivedFromKey: string | null;
  priority: TaskPriority | null;
  status: TaskStatus | null;
};

export type TaskListFilter = {
  status?: TaskStatus;
  due?: "overdue" | "today" | "later";
  asOfOn?: string;
  source?: "followups";
};

export type CreateTaskInput = {
  id?: string;
  title: string;
  description?: string | null;
  dueOn?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  source?: TaskSource;
  entityType?: TaskLinkType | null;
  entityId?: string | null;
  derivedFromKey?: string | null;
  createdByRule?: boolean;
  now?: Date;
};

export type UpdateTaskInput = Partial<
  Omit<CreateTaskInput, "id" | "now" | "derivedFromKey">
> & { now?: Date };

export type ConvertDerivedInput = {
  sourceKey: string;
  id?: string;
  now?: Date;
};

export function parseTaskListFilter(
  searchParams: URLSearchParams,
  asOfOn: string,
): TaskListFilter {
  const statusValue = searchParams.get("status");
  const dueValue = searchParams.get("due");
  const sourceValue = searchParams.get("source");
  const status = isTaskStatus(statusValue) ? statusValue : undefined;
  const due =
    dueValue === "overdue" || dueValue === "today" || dueValue === "later"
      ? dueValue
      : undefined;
  const source = sourceValue === "followups" ? "followups" : undefined;
  return {
    ...(status ? { status } : {}),
    ...(due ? { due, asOfOn } : {}),
    ...(source ? { source, asOfOn } : {}),
  };
}

export class TaskInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskInputError";
  }
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredTitle(value: string): string {
  const title = value.trim();
  if (title.length === 0) {
    throw new TaskInputError("Task title is required.");
  }
  return title;
}

function optionalDate(
  value: string | null | undefined,
  label = "Due date",
): string | null {
  const normalized = optionalText(value);
  if (normalized === null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new TaskInputError(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new TaskInputError(`${label} must be a real calendar date.`);
  }
  return normalized;
}

function validPriority(value: unknown): TaskPriority {
  if (value === undefined || value === null) {
    return DEFAULT_TASK_PRIORITY;
  }
  if (!isTaskPriority(value)) {
    throw new TaskInputError("Choose a valid priority.");
  }
  return value;
}

function validStatus(value: unknown): TaskStatus {
  if (value === undefined || value === null) {
    return DEFAULT_TASK_STATUS;
  }
  if (!isTaskStatus(value)) {
    throw new TaskInputError("Choose a valid status.");
  }
  return value;
}

function validSource(value: unknown): TaskSource {
  if (value === undefined || value === null) {
    return DEFAULT_TASK_SOURCE;
  }
  if (!isTaskSource(value)) {
    throw new TaskInputError("Choose a valid source.");
  }
  return value;
}

function validLink(
  entityType: TaskLinkType | null | undefined,
  entityId: string | null | undefined,
): { entityType: TaskLinkType | null; entityId: string | null } {
  const type = entityType ?? null;
  const id = optionalText(entityId);
  if (type === null && id === null) {
    return { entityType: null, entityId: null };
  }
  if (type === null || id === null) {
    throw new TaskInputError("A linked task needs both an entity type and id.");
  }
  if (!isTaskLinkType(type)) {
    throw new TaskInputError("Choose a valid linked entity.");
  }
  return { entityType: type, entityId: id };
}

function ownedLinkedEntity(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TaskLinkType,
  entityId: string,
) {
  const workspace = eq(
    entityType === "company"
      ? company.workspaceId
      : entityType === "contact"
        ? contact.workspaceId
        : entityType === "opportunity"
          ? opportunity.workspaceId
          : entityType === "application"
            ? application.workspaceId
            : referralRequest.workspaceId,
    tenant.workspaceId,
  );
  if (entityType === "company") {
    return transaction
      .select({ id: company.id, label: company.name })
      .from(company)
      .where(and(workspace, eq(company.id, entityId)))
      .get();
  }
  if (entityType === "contact") {
    return transaction
      .select({ id: contact.id, label: contact.name })
      .from(contact)
      .where(and(workspace, eq(contact.id, entityId)))
      .get();
  }
  if (entityType === "opportunity") {
    return transaction
      .select({
        id: opportunity.id,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
      .from(opportunity)
      .innerJoin(
        company,
        and(
          eq(company.workspaceId, opportunity.workspaceId),
          eq(company.id, opportunity.companyId),
        ),
      )
      .where(and(workspace, eq(opportunity.id, entityId)))
      .get();
  }
  if (entityType === "application") {
    return transaction
      .select({
        id: application.id,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
      .from(application)
      .innerJoin(
        opportunity,
        and(
          eq(opportunity.workspaceId, application.workspaceId),
          eq(opportunity.id, application.opportunityId),
        ),
      )
      .innerJoin(
        company,
        and(
          eq(company.workspaceId, opportunity.workspaceId),
          eq(company.id, opportunity.companyId),
        ),
      )
      .where(and(workspace, eq(application.id, entityId)))
      .get();
  }
  return transaction
    .select({ id: referralRequest.id, label: contact.name })
    .from(referralRequest)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, referralRequest.workspaceId),
        eq(contact.id, referralRequest.contactId),
      ),
    )
    .where(and(workspace, eq(referralRequest.id, entityId)))
    .get();
}

function requireOwnedLink(
  transaction: AppTransaction,
  tenant: TenantContext,
  entityType: TaskLinkType | null,
  entityId: string | null,
) {
  if (entityType === null || entityId === null) {
    return;
  }
  const found = ownedLinkedEntity(transaction, tenant, entityType, entityId);
  if (!found) {
    throw new TaskInputError("Linked entity not found.");
  }
}

function withEntityLabel(
  transaction: AppTransaction,
  tenant: TenantContext,
  row: Task,
): TaskListItem {
  if (row.entityType === null || row.entityId === null) {
    return { ...row, entityLabel: null };
  }
  const found = ownedLinkedEntity(
    transaction,
    tenant,
    row.entityType,
    row.entityId,
  );
  return { ...row, entityLabel: found?.label ?? null };
}

function compareDueItems(left: DueItem, right: DueItem) {
  const dueLeft = left.dueOn ?? "9999-99-99";
  const dueRight = right.dueOn ?? "9999-99-99";
  if (dueLeft !== dueRight) {
    return dueLeft.localeCompare(dueRight);
  }
  const title = left.title.localeCompare(right.title);
  return title !== 0 ? title : left.sourceKey.localeCompare(right.sourceKey);
}

function derivedKindToLink(
  kind: DueSourceKind,
): TaskLinkType | null {
  switch (kind) {
    case "company_next_action":
      return "company";
    case "contact_next_action":
      return "contact";
    case "opportunity_next_action":
    case "opportunity_deadline":
      return "opportunity";
    case "referral_follow_up":
      return "referral";
    case "interview":
    case "assessment_deadline":
    case "offer_deadline":
      return "opportunity";
    case "task":
    case "sequence_follow_up":
      return null;
  }
}

function loadDerivedSource(
  transaction: AppTransaction,
  tenant: TenantContext,
  kind: DueSourceKind,
  entityId: string,
): { title: string; dueOn: string; entityType: TaskLinkType; entityId: string; entityLabel: string } | undefined {
  const linkType = derivedKindToLink(kind);
  if (!linkType) {
    return undefined;
  }
  if (kind === "company_next_action") {
    const row = transaction
      .select({
        title: company.nextAction,
        dueOn: company.nextActionDue,
        label: company.name,
      })
      .from(company)
      .where(
        and(eq(company.workspaceId, tenant.workspaceId), eq(company.id, entityId)),
      )
      .get();
    const title = optionalText(row?.title);
    const dueOn = optionalText(row?.dueOn);
    if (!row || title === null || dueOn === null) {
      return undefined;
    }
    return { title, dueOn, entityType: "company", entityId, entityLabel: row.label };
  }
  if (kind === "contact_next_action") {
    const row = transaction
      .select({
        title: contact.nextAction,
        dueOn: contact.followUpOn,
        label: contact.name,
        networkingStatus: contact.networkingStatus,
      })
      .from(contact)
      .where(
        and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, entityId)),
      )
      .get();
    const dueOn = optionalText(row?.dueOn);
    if (
      !row ||
      dueOn === null ||
      isNetworkingTerminalStatus(row.networkingStatus)
    ) {
      return undefined;
    }
    return {
      title: derivedDueItemTitle("contact_next_action", row.title),
      dueOn,
      entityType: "contact",
      entityId,
      entityLabel: row.label,
    };
  }
  if (kind === "opportunity_next_action") {
    const row = transaction
      .select({
        title: opportunity.nextAction,
        dueOn: opportunity.nextActionDue,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
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
          eq(opportunity.id, entityId),
        ),
      )
      .get();
    const title = optionalText(row?.title);
    const dueOn = optionalText(row?.dueOn);
    if (!row || title === null || dueOn === null) {
      return undefined;
    }
    return {
      title,
      dueOn,
      entityType: "opportunity",
      entityId,
      entityLabel: row.label,
    };
  }
  if (kind === "opportunity_deadline") {
    const row = transaction
      .select({
        dueOn: opportunity.deadlineOn,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
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
          eq(opportunity.id, entityId),
        ),
      )
      .get();
    const dueOn = optionalText(row?.dueOn);
    if (!row || dueOn === null) {
      return undefined;
    }
    return {
      title: derivedDueItemTitle("opportunity_deadline", null),
      dueOn,
      entityType: "opportunity",
      entityId,
      entityLabel: row.label,
    };
  }
  if (kind === "interview") {
    const timeZone =
      getWorkspaceSettings(transaction, tenant, tenant.workspaceId)?.timezone ??
      DEFAULT_TIME_ZONE;
    const row = transaction
      .select({
        at: interview.at,
        result: interview.result,
        roundIndex: interview.roundIndex,
        kind: interview.kind,
        opportunityId: interview.opportunityId,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
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
        and(
          eq(interview.workspaceId, tenant.workspaceId),
          eq(interview.id, entityId),
        ),
      )
      .get();
    const dueOn = interviewDueOn(row?.at, timeZone);
    if (!row || dueOn === null) {
      return undefined;
    }
    return {
      title: interviewRoundTitle(row.roundIndex, row.kind),
      dueOn,
      entityType: "opportunity",
      entityId: row.opportunityId,
      entityLabel: row.label,
    };
  }
  if (kind === "assessment_deadline") {
    const timeZone =
      getWorkspaceSettings(transaction, tenant, tenant.workspaceId)?.timezone ??
      DEFAULT_TIME_ZONE;
    const row = transaction
      .select({
        dueAt: assessment.dueAt,
        status: assessment.status,
        opportunityId: assessment.opportunityId,
        companyName: company.name,
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
        and(
          eq(assessment.workspaceId, tenant.workspaceId),
          eq(assessment.id, entityId),
        ),
      )
      .get();
    const dueOn = assessmentDueOn(row?.dueAt, timeZone);
    if (!row || dueOn === null || !isOpenAssessmentStatus(row.status)) {
      return undefined;
    }
    return {
      title: derivedDueItemTitle("assessment_deadline", derivedAssessmentTitle(row.companyName)),
      dueOn,
      entityType: "opportunity",
      entityId: row.opportunityId,
      entityLabel: row.companyName,
    };
  }
  if (kind === "offer_deadline") {
    const row = transaction
      .select({
        offerDeadlineOn: application.offerDeadlineOn,
        offerDecision: application.offerDecision,
        opportunityId: application.opportunityId,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
      .from(application)
      .innerJoin(
        opportunity,
        and(
          eq(opportunity.workspaceId, application.workspaceId),
          eq(opportunity.id, application.opportunityId),
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
          eq(application.workspaceId, tenant.workspaceId),
          eq(application.id, entityId),
        ),
      )
      .get();
    const dueOn = optionalText(row?.offerDeadlineOn);
    if (!row || dueOn === null || !isOpenOfferDeadline(row.offerDeadlineOn, row.offerDecision)) {
      return undefined;
    }
    return {
      title: derivedDueItemTitle("offer_deadline", null),
      dueOn,
      entityType: "opportunity",
      entityId: row.opportunityId,
      entityLabel: row.label,
    };
  }
  const row = transaction
    .select({
      title: referralRequest.nextAction,
      dueOn: referralRequest.followUpOn,
      label: contact.name,
      stage: referralRequest.stage,
    })
    .from(referralRequest)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, referralRequest.workspaceId),
        eq(contact.id, referralRequest.contactId),
      ),
    )
    .where(
      and(
        eq(referralRequest.workspaceId, tenant.workspaceId),
        eq(referralRequest.id, entityId),
      ),
    )
    .get();
  const dueOn = optionalText(row?.dueOn);
  if (!row || dueOn === null || isReferralTerminalStage(row.stage)) {
    return undefined;
  }
    return {
      title: derivedDueItemTitle("referral_follow_up", row.title),
      dueOn,
      entityType: "referral",
      entityId,
      entityLabel: row.label,
    };
  }

function findOpenDerivedTask(
  transaction: AppTransaction,
  tenant: TenantContext,
  sourceKey: string,
) {
  return transaction
    .select()
    .from(task)
    .where(
      and(
        eq(task.workspaceId, tenant.workspaceId),
        eq(task.derivedFromKey, sourceKey),
        eq(task.status, "open"),
      ),
    )
    .get();
}

function insertTask(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: CreateTaskInput,
): Task {
  const link = validLink(input.entityType, input.entityId);
  requireOwnedLink(transaction, tenant, link.entityType, link.entityId);
  const status = validStatus(input.status);
  const now = input.now ?? new Date();
  const created = transaction
    .insert(task)
    .values({
      id: input.id ?? randomUUID(),
      workspaceId: tenant.workspaceId,
      title: requiredTitle(input.title),
      description: optionalText(input.description),
      dueOn: optionalDate(input.dueOn),
      priority: validPriority(input.priority),
      status,
      source: validSource(input.source),
      entityType: link.entityType,
      entityId: link.entityId,
      derivedFromKey: optionalText(input.derivedFromKey),
      createdByRule: input.createdByRule ?? false,
      completedAt: isTerminalTaskStatus(status) ? now : null,
      createdAt: now,
    })
    .returning()
    .get();
  logEvent(transaction, tenant, {
    at: now,
    kind: "TASK_CREATED",
    entityType: "task",
    entityId: created.id,
  });
  return created;
}

export function createTask(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateTaskInput,
): Task {
  return database.transaction((transaction) =>
    insertTask(transaction, tenant, input),
  );
}

export function getTask(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): TaskListItem | undefined {
  const row = database
    .select()
    .from(task)
    .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
    .get();
  if (!row) {
    return undefined;
  }
  return database.transaction((transaction) =>
    withEntityLabel(transaction, tenant, row),
  );
}

export function listTasks(
  database: AppDatabase,
  tenant: TenantContext,
  filter: TaskListFilter = {},
): TaskListItem[] {
  const status = filter.status ?? DEFAULT_TASK_STATUS;
  const rows = database
    .select()
    .from(task)
    .where(
      and(eq(task.workspaceId, tenant.workspaceId), eq(task.status, status)),
    )
    .orderBy(asc(task.dueOn), asc(task.title), asc(task.id))
    .all();

  const asOfOn = filter.asOfOn;
  const due = filter.due;
  const dated = rows.filter((row) => {
    if (!due) {
      return true;
    }
    if (!asOfOn) {
      throw new TaskInputError("A due filter needs today's date.");
    }
    if (due === "overdue") {
      return row.dueOn !== null && row.dueOn < asOfOn;
    }
    if (due === "today") {
      return row.dueOn === asOfOn;
    }
    return row.dueOn === null || row.dueOn > asOfOn;
  });

  return database.transaction((transaction) =>
    dated.map((row) => withEntityLabel(transaction, tenant, row)),
  );
}

export function completeTask(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): Task | undefined {
  return database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(task)
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .get();
    if (!current) {
      return undefined;
    }
    if (isTerminalTaskStatus(current.status)) {
      return current;
    }
    const updated = transaction
      .update(task)
      .set({ status: "completed", completedAt: at })
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at,
      kind: "TASK_COMPLETED",
      entityType: "task",
      entityId: id,
    });
    return updated;
  });
}

export function deleteTask(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  at = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const current = transaction
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .get();
    if (!current) {
      return false;
    }
    transaction
      .delete(notification)
      .where(
        and(
          eq(notification.workspaceId, tenant.workspaceId),
          eq(notification.dueKey, dueSourceKey("task", id)),
        ),
      )
      .run();
    transaction
      .delete(task)
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .run();
    logEvent(transaction, tenant, {
      at,
      kind: "TASK_DELETED",
      entityType: "task",
      entityId: id,
    });
    return true;
  });
}

export function updateTask(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateTaskInput,
): Task | undefined {
  return database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(task)
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .get();
    if (!current) {
      return undefined;
    }
    const values: Partial<typeof task.$inferInsert> = {};
    if (input.title !== undefined) values.title = requiredTitle(input.title);
    if (input.description !== undefined)
      values.description = optionalText(input.description);
    if (input.dueOn !== undefined) values.dueOn = optionalDate(input.dueOn);
    if (input.priority !== undefined)
      values.priority = validPriority(input.priority);
    if (input.source !== undefined) values.source = validSource(input.source);
    if (input.createdByRule !== undefined)
      values.createdByRule = input.createdByRule;
    if (input.entityType !== undefined || input.entityId !== undefined) {
      const link = validLink(
        input.entityType !== undefined ? input.entityType : current.entityType,
        input.entityId !== undefined ? input.entityId : current.entityId,
      );
      requireOwnedLink(transaction, tenant, link.entityType, link.entityId);
      values.entityType = link.entityType;
      values.entityId = link.entityId;
    }
    if (input.status !== undefined) {
      const next = validStatus(input.status);
      values.status = next;
      if (isTerminalTaskStatus(next) && current.status !== "completed") {
        values.completedAt = input.now ?? new Date();
      }
      if (!isTerminalTaskStatus(next)) {
        values.completedAt = null;
      }
    }
    if (Object.keys(values).length === 0) {
      return current;
    }
    const updated = transaction
      .update(task)
      .set(values)
      .where(and(eq(task.workspaceId, tenant.workspaceId), eq(task.id, id)))
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: input.now ?? new Date(),
      kind: "TASK_UPDATED",
      entityType: "task",
      entityId: id,
      payload: { fields: Object.keys(values).sort() },
    });
    return updated;
  });
}

export function createTaskFromDerived(
  database: AppDatabase,
  tenant: TenantContext,
  input: ConvertDerivedInput,
): Task | undefined {
  const parsed = parseDueSourceKey(input.sourceKey);
  if (!parsed || parsed.kind === "task" || parsed.kind === "sequence_follow_up") {
    return undefined;
  }
  return database.transaction((transaction) => {
    const existing = findOpenDerivedTask(
      transaction,
      tenant,
      input.sourceKey,
    );
    if (existing) {
      return existing;
    }
    const derived = loadDerivedSource(
      transaction,
      tenant,
      parsed.kind,
      parsed.entityId,
    );
    if (!derived) {
      return undefined;
    }
    return insertTask(transaction, tenant, {
      id: input.id,
      title: derived.title,
      dueOn: derived.dueOn,
      entityType: derived.entityType,
      entityId: derived.entityId,
      derivedFromKey: input.sourceKey,
      source: "manual",
      now: input.now,
    });
  });
}

export function listDueItems(
  database: AppDatabase,
  tenant: TenantContext,
): DueItem[] {
  return database.transaction((transaction) => {
    const openTasks = transaction
      .select()
      .from(task)
      .where(
        and(
          eq(task.workspaceId, tenant.workspaceId),
          eq(task.status, "open"),
        ),
      )
      .all();
    const suppressed = new Set(
      openTasks
        .map((row) => row.derivedFromKey)
        .filter((key): key is string => key != null && key.length > 0),
    );

    const items: DueItem[] = [];

    for (const row of transaction
      .select({
        id: company.id,
        title: company.nextAction,
        dueOn: company.nextActionDue,
        label: company.name,
      })
      .from(company)
      .where(
        and(
          eq(company.workspaceId, tenant.workspaceId),
          isNotNull(company.nextAction),
          isNotNull(company.nextActionDue),
          sql`length(trim(${company.nextAction})) > 0`,
        ),
      )
      .all()) {
      const title = optionalText(row.title);
      const dueOn = optionalText(row.dueOn);
      if (title === null || dueOn === null) {
        continue;
      }
      const sourceKey = dueSourceKey("company_next_action", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title,
        dueOn,
        entityType: "company",
        entityId: row.id,
        entityLabel: row.label,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of transaction
      .select({
        id: contact.id,
        title: contact.nextAction,
        dueOn: contact.followUpOn,
        label: contact.name,
        networkingStatus: contact.networkingStatus,
      })
      .from(contact)
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          isNotNull(contact.followUpOn),
        ),
      )
      .all()) {
      const dueOn = optionalText(row.dueOn);
      if (dueOn === null || isNetworkingTerminalStatus(row.networkingStatus)) {
        continue;
      }
      const sourceKey = dueSourceKey("contact_next_action", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title: derivedDueItemTitle("contact_next_action", row.title),
        dueOn,
        entityType: "contact",
        entityId: row.id,
        entityLabel: row.label,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of transaction
      .select({
        id: opportunity.id,
        title: opportunity.nextAction,
        dueOn: opportunity.nextActionDue,
        label: sql<string>`trim(${company.name} || ' ' || ${opportunity.role})`,
      })
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
          isNotNull(opportunity.nextAction),
          isNotNull(opportunity.nextActionDue),
          sql`length(trim(${opportunity.nextAction})) > 0`,
        ),
      )
      .all()) {
      const title = optionalText(row.title);
      const dueOn = optionalText(row.dueOn);
      if (title === null || dueOn === null) {
        continue;
      }
      const sourceKey = dueSourceKey("opportunity_next_action", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title,
        dueOn,
        entityType: "opportunity",
        entityId: row.id,
        entityLabel: row.label,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of transaction
      .select({
        id: referralRequest.id,
        title: referralRequest.nextAction,
        dueOn: referralRequest.followUpOn,
        label: contact.name,
        stage: referralRequest.stage,
      })
      .from(referralRequest)
      .innerJoin(
        contact,
        and(
          eq(contact.workspaceId, referralRequest.workspaceId),
          eq(contact.id, referralRequest.contactId),
        ),
      )
      .where(
        and(
          eq(referralRequest.workspaceId, tenant.workspaceId),
          isNotNull(referralRequest.followUpOn),
        ),
      )
      .all()) {
      const dueOn = optionalText(row.dueOn);
      if (dueOn === null || isReferralTerminalStage(row.stage)) {
        continue;
      }
      const sourceKey = dueSourceKey("referral_follow_up", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title: derivedDueItemTitle("referral_follow_up", row.title),
        dueOn,
        entityType: "referral",
        entityId: row.id,
        entityLabel: row.label,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    const timeZone =
      getWorkspaceSettings(transaction, tenant, tenant.workspaceId)?.timezone ??
      DEFAULT_TIME_ZONE;
    for (const row of listPendingInterviewDueRows(
      transaction,
      tenant,
      timeZone,
    )) {
      const sourceKey = dueSourceKey("interview", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title: row.title,
        dueOn: row.dueOn,
        entityType: "opportunity",
        entityId: row.opportunityId,
        entityLabel: row.entityLabel,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of listOpenAssessmentDueRows(transaction, tenant, timeZone)) {
      const sourceKey = dueSourceKey("assessment_deadline", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title: row.title,
        dueOn: row.dueOn,
        entityType: "opportunity",
        entityId: row.opportunityId,
        entityLabel: row.entityLabel,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of listOpenOfferDeadlineDueRows(transaction, tenant)) {
      const sourceKey = dueSourceKey("offer_deadline", row.id);
      if (suppressed.has(sourceKey)) {
        continue;
      }
      items.push({
        sourceKey,
        origin: "derived",
        title: row.title,
        dueOn: row.dueOn,
        entityType: "opportunity",
        entityId: row.opportunityId,
        entityLabel: row.entityLabel,
        taskId: null,
        derivedFromKey: null,
        priority: null,
        status: null,
      });
    }

    for (const row of listDueSequenceItemsInTransaction(transaction, tenant)) {
      if (suppressed.has(row.sourceKey)) {
        continue;
      }
      items.push(row);
    }

    for (const row of openTasks) {
      const labeled = withEntityLabel(transaction, tenant, row);
      items.push({
        sourceKey: dueSourceKey("task", row.id),
        origin: "task",
        title: row.title,
        dueOn: row.dueOn,
        entityType: row.entityType,
        entityId: row.entityId,
        entityLabel: labeled.entityLabel ?? row.title,
        taskId: row.id,
        derivedFromKey: row.derivedFromKey,
        priority: row.priority,
        status: row.status,
      });
    }

    return items.sort(compareDueItems);
  });
}
