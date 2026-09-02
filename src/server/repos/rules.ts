import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { assessmentDueOn } from "../../domain/assessment";
import { interviewDueOn } from "../../domain/interview";
import type { OpportunityStage } from "../../domain/opportunity";
import { calendarDateInZone, type ReferralStage } from "../../domain/referral";
import {
  AUTOMATION_RULES,
  REFERRAL_NO_RESPONSE_TASK_TITLE,
  automationRuleRowId,
  canAdvanceToReadyToApply,
  evaluateStaleMarks,
  indexStaleMarks,
  isAutomationRuleSlug,
  referralNoResponseDueOn,
  referralNoResponseTaskKey,
  type AutomationRuleKind,
  type AutomationRuleSlug,
  type StaleMark,
  type StaleScanInput,
} from "../../domain/rules";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { getWorkspaceSettings } from "../db/foundation";
import {
  activityEvent,
  application,
  assessment,
  automationExecution,
  automationRule,
  contact,
  interaction,
  interview,
  opportunity,
  referralRequest,
  task,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";

export type AutomationRule = typeof automationRule.$inferSelect;
export type AutomationExecution = typeof automationExecution.$inferSelect;

export type AutomationRuleView = {
  slug: AutomationRuleSlug;
  label: string;
  kind: AutomationRuleKind;
  enabled: boolean;
};

export class AutomationRuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationRuleInputError";
  }
}

export type ReferralRuleInput = {
  previousStage: ReferralStage | null;
  referral: {
    id: string;
    stage: ReferralStage;
    requestedOn: string | null;
    opportunityId: string | null;
  };
  now: Date;
};

function workspaceZone(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
): string {
  return (
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE
  );
}

function ownedRule(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  slug: AutomationRuleSlug,
) {
  return transaction
    .select()
    .from(automationRule)
    .where(
      and(
        eq(automationRule.workspaceId, tenant.workspaceId),
        eq(automationRule.slug, slug),
      ),
    )
    .get();
}

function isEnabled(
  transaction: AppTransaction,
  tenant: TenantContext,
  slug: AutomationRuleSlug,
): boolean {
  return ownedRule(transaction, tenant, slug)?.enabled ?? true;
}

function requireRuleRow(
  transaction: AppTransaction,
  tenant: TenantContext,
  slug: AutomationRuleSlug,
  now: Date,
): AutomationRule {
  const existing = ownedRule(transaction, tenant, slug);
  if (existing) {
    return existing;
  }
  return transaction
    .insert(automationRule)
    .values({
      id: automationRuleRowId(tenant.workspaceId, slug),
      workspaceId: tenant.workspaceId,
      slug,
      enabled: true,
      specJson: {},
      createdAt: now,
    })
    .returning()
    .get();
}

function recordExecution(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: {
    slug: AutomationRuleSlug;
    at: Date;
    entityType: string;
    entityId: string;
    trigger: Record<string, unknown>;
    result: Record<string, unknown>;
  },
) {
  const rule = requireRuleRow(transaction, tenant, input.slug, input.at);
  transaction
    .insert(automationExecution)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      ruleId: rule.id,
      at: input.at,
      inputJson: input.trigger,
      resultJson: input.result,
    })
    .run();
  logEvent(transaction, tenant, {
    at: input.at,
    kind: "RULE_EXECUTED",
    entityType: input.entityType,
    entityId: input.entityId,
    payload: { ruleSlug: input.slug, ...input.result },
  });
}

function insertRuleTask(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: {
    title: string;
    dueOn: string;
    entityId: string;
    derivedFromKey: string;
    now: Date;
    ruleSlug: AutomationRuleSlug;
  },
) {
  const created = transaction
    .insert(task)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      title: input.title,
      dueOn: input.dueOn,
      source: "rule",
      createdByRule: true,
      entityType: "referral",
      entityId: input.entityId,
      derivedFromKey: input.derivedFromKey,
      createdAt: input.now,
    })
    .returning()
    .get();
  logEvent(transaction, tenant, {
    at: input.now,
    kind: "TASK_CREATED",
    entityType: "task",
    entityId: created.id,
    payload: { ruleSlug: input.ruleSlug },
  });
  return created;
}

function completeOpenTask(
  transaction: AppTransaction,
  tenant: TenantContext,
  id: string,
  at: Date,
  ruleSlug: AutomationRuleSlug,
) {
  const updated = transaction
    .update(task)
    .set({ status: "completed", completedAt: at })
    .where(
      and(
        eq(task.workspaceId, tenant.workspaceId),
        eq(task.id, id),
        eq(task.status, "open"),
      ),
    )
    .returning()
    .get();
  if (!updated) {
    return undefined;
  }
  logEvent(transaction, tenant, {
    at,
    kind: "TASK_COMPLETED",
    entityType: "task",
    entityId: id,
    payload: { ruleSlug },
  });
  return updated;
}

function syncNoResponseFollowUp(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: ReferralRuleInput,
) {
  const key = referralNoResponseTaskKey(input.referral.id);
  const existing = transaction
    .select()
    .from(task)
    .where(
      and(
        eq(task.workspaceId, tenant.workspaceId),
        eq(task.derivedFromKey, key),
        eq(task.status, "open"),
      ),
    )
    .get();

  if (input.referral.stage !== "requested" || !input.referral.requestedOn) {
    if (existing) {
      const completed = completeOpenTask(
        transaction,
        tenant,
        existing.id,
        input.now,
        "referral_no_response_follow_up",
      );
      if (completed) {
        recordExecution(transaction, tenant, {
          slug: "referral_no_response_follow_up",
          at: input.now,
          entityType: "referral_request",
          entityId: input.referral.id,
          trigger: { stage: input.referral.stage },
          result: { completedTaskId: completed.id },
        });
      }
    }
    return;
  }

  if (!isEnabled(transaction, tenant, "referral_no_response_follow_up")) {
    return;
  }

  const dueOn = referralNoResponseDueOn(input.referral.requestedOn);
  if (existing) {
    if (existing.dueOn !== dueOn) {
      transaction
        .update(task)
        .set({ dueOn })
        .where(
          and(
            eq(task.workspaceId, tenant.workspaceId),
            eq(task.id, existing.id),
          ),
        )
        .run();
    }
    return;
  }

  const created = insertRuleTask(transaction, tenant, {
    title: REFERRAL_NO_RESPONSE_TASK_TITLE,
    dueOn,
    entityId: input.referral.id,
    derivedFromKey: key,
    now: input.now,
    ruleSlug: "referral_no_response_follow_up",
  });
  recordExecution(transaction, tenant, {
    slug: "referral_no_response_follow_up",
    at: input.now,
    entityType: "referral_request",
    entityId: input.referral.id,
    trigger: {
      stage: input.referral.stage,
      requestedOn: input.referral.requestedOn,
    },
    result: { taskId: created.id, dueOn },
  });
}

function maybeAdvanceReadyToApply(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: ReferralRuleInput,
) {
  const becameReceived =
    input.referral.stage === "referral_received" &&
    input.previousStage !== "referral_received";
  if (!becameReceived || !input.referral.opportunityId) {
    return;
  }
  if (!isEnabled(transaction, tenant, "referral_received_ready_to_apply")) {
    return;
  }

  const row = transaction
    .select({ id: opportunity.id, stage: opportunity.stage })
    .from(opportunity)
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.id, input.referral.opportunityId),
      ),
    )
    .get();
  if (!row || !canAdvanceToReadyToApply(row.stage)) {
    return;
  }

  transaction
    .update(opportunity)
    .set({ stage: "ready_to_apply" })
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        eq(opportunity.id, row.id),
      ),
    )
    .run();
  logEvent(transaction, tenant, {
    at: input.now,
    kind: "OPPORTUNITY_UPDATED",
    entityType: "opportunity",
    entityId: row.id,
    payload: {
      fields: ["stage"],
      ruleSlug: "referral_received_ready_to_apply",
    },
  });
  recordExecution(transaction, tenant, {
    slug: "referral_received_ready_to_apply",
    at: input.now,
    entityType: "opportunity",
    entityId: row.id,
    trigger: {
      referralId: input.referral.id,
      fromStage: row.stage,
    },
    result: { stage: "ready_to_apply" },
  });
}

export function afterReferralWrite(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: ReferralRuleInput,
) {
  syncNoResponseFollowUp(transaction, tenant, input);
  maybeAdvanceReadyToApply(transaction, tenant, input);
}

export function afterApplicationSubmitted(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: { opportunityId: string; applicationId: string; now: Date },
) {
  if (!isEnabled(transaction, tenant, "applied_cancel_referral_outreach")) {
    return;
  }

  const referralIds = transaction
    .select({ id: referralRequest.id })
    .from(referralRequest)
    .where(
      and(
        eq(referralRequest.workspaceId, tenant.workspaceId),
        eq(referralRequest.opportunityId, input.opportunityId),
      ),
    )
    .all()
    .map((row) => row.id);
  if (referralIds.length === 0) {
    return;
  }

  const open = transaction
    .select()
    .from(task)
    .where(
      and(
        eq(task.workspaceId, tenant.workspaceId),
        eq(task.status, "open"),
        eq(task.source, "rule"),
        eq(task.entityType, "referral"),
        inArray(task.entityId, referralIds),
      ),
    )
    .all();
  if (open.length === 0) {
    return;
  }

  const cancelledIds: string[] = [];
  for (const row of open) {
    completeOpenTask(
      transaction,
      tenant,
      row.id,
      input.now,
      "applied_cancel_referral_outreach",
    );
    cancelledIds.push(row.id);
  }
  recordExecution(transaction, tenant, {
    slug: "applied_cancel_referral_outreach",
    at: input.now,
    entityType: "application",
    entityId: input.applicationId,
    trigger: { opportunityId: input.opportunityId },
    result: { cancelledTaskIds: cancelledIds },
  });
}

export function listAutomationRules(
  database: AppDatabase,
  tenant: TenantContext,
): AutomationRuleView[] {
  const rows = database
    .select()
    .from(automationRule)
    .where(eq(automationRule.workspaceId, tenant.workspaceId))
    .all();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return AUTOMATION_RULES.map((definition) => ({
    slug: definition.slug,
    label: definition.label,
    kind: definition.kind,
    enabled: bySlug.get(definition.slug)?.enabled ?? true,
  }));
}

export function setAutomationRuleEnabled(
  database: AppDatabase,
  tenant: TenantContext,
  slug: string,
  enabled: boolean,
  now = new Date(),
): AutomationRuleView | undefined {
  if (!isAutomationRuleSlug(slug)) {
    throw new AutomationRuleInputError("Choose a built-in automation rule.");
  }

  database
    .insert(automationRule)
    .values({
      id: automationRuleRowId(tenant.workspaceId, slug),
      workspaceId: tenant.workspaceId,
      slug,
      enabled,
      specJson: {},
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [automationRule.workspaceId, automationRule.slug],
      set: { enabled },
    })
    .run();

  return listAutomationRules(database, tenant).find((rule) => rule.slug === slug);
}

export function listAutomationExecutions(
  database: AppDatabase,
  tenant: TenantContext,
): AutomationExecution[] {
  return database
    .select()
    .from(automationExecution)
    .where(eq(automationExecution.workspaceId, tenant.workspaceId))
    .all();
}

export function listStaleMarks(
  database: AppDatabase,
  tenant: TenantContext,
  asOfOn?: string,
): StaleMark[] {
  const timeZone = workspaceZone(database, tenant);
  const asOf = asOfOn ?? calendarDateInZone(timeZone);
  const enabledSlugs = new Set(
    listAutomationRules(database, tenant)
      .filter((rule) => rule.kind === "stale" && rule.enabled)
      .map((rule) => rule.slug),
  );

  const opportunities = database
    .select({
      id: opportunity.id,
      bucket: opportunity.bucket,
      stage: opportunity.stage,
      createdAt: opportunity.createdAt,
      deadlineOn: opportunity.deadlineOn,
      applicationId: application.id,
    })
    .from(opportunity)
    .leftJoin(
      application,
      and(
        eq(application.workspaceId, opportunity.workspaceId),
        eq(application.opportunityId, opportunity.id),
      ),
    )
    .where(eq(opportunity.workspaceId, tenant.workspaceId))
    .all();

  const referrals = database
    .select({
      id: referralRequest.id,
      opportunityId: referralRequest.opportunityId,
      stage: referralRequest.stage,
      createdAt: referralRequest.createdAt,
      requestedOn: referralRequest.requestedOn,
    })
    .from(referralRequest)
    .where(eq(referralRequest.workspaceId, tenant.workspaceId))
    .all();

  const contacts = database
    .select({
      id: contact.id,
      networkingStatus: contact.networkingStatus,
      followUpOn: contact.followUpOn,
    })
    .from(contact)
    .where(eq(contact.workspaceId, tenant.workspaceId))
    .all();

  const interactions = database
    .select({
      opportunityId: interaction.opportunityId,
      direction: interaction.direction,
      occurredAt: interaction.occurredAt,
    })
    .from(interaction)
    .where(eq(interaction.workspaceId, tenant.workspaceId))
    .all();

  const assessments = database
    .select({
      id: assessment.id,
      opportunityId: assessment.opportunityId,
      status: assessment.status,
      dueAt: assessment.dueAt,
    })
    .from(assessment)
    .where(eq(assessment.workspaceId, tenant.workspaceId))
    .all();

  const interviews = database
    .select({
      id: interview.id,
      opportunityId: interview.opportunityId,
      at: interview.at,
      result: interview.result,
    })
    .from(interview)
    .where(eq(interview.workspaceId, tenant.workspaceId))
    .all();

  const activityRows = database
    .select({
      entityType: activityEvent.entityType,
      entityId: activityEvent.entityId,
      at: activityEvent.at,
      payloadJson: activityEvent.payloadJson,
    })
    .from(activityEvent)
    .where(eq(activityEvent.workspaceId, tenant.workspaceId))
    .all();

  const input: StaleScanInput = {
    asOfOn: asOf,
    enabled: enabledSlugs,
    opportunities: opportunities.map((row) => ({
      id: row.id,
      bucket: row.bucket,
      stage: row.stage as OpportunityStage,
      createdOn: calendarDateInZone(timeZone, row.createdAt),
      deadlineOn: row.deadlineOn,
      hasApplication: row.applicationId !== null,
    })),
    referrals: referrals.map((row) => ({
      id: row.id,
      opportunityId: row.opportunityId,
      stage: row.stage,
      createdOn: calendarDateInZone(timeZone, row.createdAt),
      requestedOn: row.requestedOn,
    })),
    contacts: contacts.map((row) => ({
      id: row.id,
      networkingStatus: row.networkingStatus,
      followUpOn: row.followUpOn,
    })),
    interactions: interactions.map((row) => ({
      opportunityId: row.opportunityId,
      direction: row.direction,
      occurredOn: calendarDateInZone(timeZone, row.occurredAt),
      occurredAtMs: row.occurredAt.valueOf(),
    })),
    assessments: assessments.map((row) => ({
      id: row.id,
      opportunityId: row.opportunityId,
      status: row.status,
      dueOn: assessmentDueOn(row.dueAt, timeZone),
    })),
    interviews: interviews.map((row) => ({
      id: row.id,
      opportunityId: row.opportunityId,
      interviewOn: interviewDueOn(row.at, timeZone),
      result: row.result,
    })),
    activity: activityRows.map((row) => {
      const opportunityId =
        row.entityType === "opportunity"
          ? row.entityId
          : typeof row.payloadJson.opportunityId === "string"
            ? row.payloadJson.opportunityId
            : null;
      return {
        entityType: row.entityType,
        entityId: row.entityId,
        opportunityId,
        atOn: calendarDateInZone(timeZone, row.at),
      };
    }),
  };

  return evaluateStaleMarks(input);
}

export function listStaleIndex(
  database: AppDatabase,
  tenant: TenantContext,
  asOfOn?: string,
) {
  return indexStaleMarks(listStaleMarks(database, tenant, asOfOn));
}
