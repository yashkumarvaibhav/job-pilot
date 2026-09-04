import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";

import { DO_NOT_CONTACT } from "../../domain/contact";
import { renderEmailTemplate } from "../../domain/mail-template";
import { OPPORTUNITY_TERMINAL_STAGES } from "../../domain/opportunity";
import { calendarDateInZone } from "../../domain/referral";
import {
  HELD_MAILBOX_UNPROVEN,
  REVIEW_FOLLOW_UP_EMAIL,
  SEQUENCE_CANCEL_COPY,
  detectSequenceCancel,
  parseSequenceDueSourceKey,
  sequenceDueSourceKey,
  sequenceMailboxFreshness,
  sequenceRequestGrantsOverride,
  sequenceStepDueAt,
  type SequenceCancelReason,
} from "../../domain/sequence";
import { getWorkspaceSettings } from "../db/foundation";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  application,
  company,
  contact,
  contactMethod,
  documentVersion,
  emailAccount,
  emailSequence,
  emailTemplate,
  gmailRecoveryGeneration,
  interaction,
  opportunity,
  referralRequest,
  sendQueue,
  sequenceEnrollment,
  sequenceStep,
  settings,
  suppressionEntry,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";
import {
  approveQueueMessage,
  createQueueMessage,
  getQueueMessage,
  listQueueSummaries,
  suppressionForRecipientInTransaction,
  updateQueueMessage,
} from "./send-safety";

export class SequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SequenceError";
  }
}

export type EmailSequence = typeof emailSequence.$inferSelect;
export type SequenceStep = typeof sequenceStep.$inferSelect;
export type SequenceEnrollment = typeof sequenceEnrollment.$inferSelect;

export type SequenceStepInput = {
  offsetDays: number;
  templateId: string;
};

export type SequenceListItem = EmailSequence & {
  steps: SequenceStep[];
  enrollmentCount: number;
};

export type SequenceReview = {
  id: string;
  sourceKey: string;
  enrollmentId: string;
  stepId: string;
  origin: "sequence";
  status: "awaiting_approval" | "approved" | "held";
  accountId: string;
  accountEmail: string;
  contactId: string;
  contactName: string;
  recipient: string;
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  attachments: { id: string; name: string }[];
  sendAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  approvalRequired: true;
  sendAnywayAvailable: false;
};

const TERMINAL_OPPORTUNITY = new Set(
  OPPORTUNITY_TERMINAL_STAGES.map((stage) => stage.value),
);

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new SequenceError(`${label} is required.`);
  if (normalized.length > maximum) {
    throw new SequenceError(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function workspaceZone(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
): string {
  return (
    getWorkspaceSettings(transaction, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE
  );
}

export function sequenceQueueRowId(enrollmentId: string, stepId: string): string {
  return createHash("sha256")
    .update(sequenceDueSourceKey(enrollmentId, stepId), "utf8")
    .digest("hex")
    .slice(0, 32);
}

function orderedSteps(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  sequenceId: string,
): SequenceStep[] {
  return transaction
    .select()
    .from(sequenceStep)
    .where(
      and(
        eq(sequenceStep.workspaceId, tenant.workspaceId),
        eq(sequenceStep.sequenceId, sequenceId),
      ),
    )
    .orderBy(asc(sequenceStep.offsetDays), asc(sequenceStep.id))
    .all();
}

function ownedSequence(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  id: string,
) {
  const row = transaction
    .select()
    .from(emailSequence)
    .where(
      and(
        eq(emailSequence.workspaceId, tenant.workspaceId),
        eq(emailSequence.id, id),
      ),
    )
    .get();
  if (!row) throw new SequenceError("Sequence not found.");
  return row;
}

function ownedConnectedAccount(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  accountId: string,
) {
  const row = transaction
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  if (!row) throw new SequenceError("Gmail account not found.");
  if (row.status !== "connected") {
    throw new SequenceError("The selected Gmail account is disconnected.");
  }
  return row;
}

function ownedContactEmail(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  contactId: string,
) {
  const row = transaction
    .select()
    .from(contact)
    .where(
      and(eq(contact.workspaceId, tenant.workspaceId), eq(contact.id, contactId)),
    )
    .get();
  if (!row) throw new SequenceError("Contact not found.");
  const method = transaction
    .select()
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.contactId, contactId),
        eq(contactMethod.kind, "email"),
      ),
    )
    .orderBy(asc(contactMethod.isPrimary), asc(contactMethod.createdAt))
    .all()
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))[0];
  if (!method) throw new SequenceError("This contact has no valid email address.");
  return { contact: row, recipient: method.valueNormalized };
}

function writeSteps(
  transaction: AppTransaction,
  tenant: TenantContext,
  sequenceId: string,
  steps: SequenceStepInput[],
  now: Date,
): SequenceStep[] {
  if (steps.length === 0) {
    throw new SequenceError("A sequence needs at least one step.");
  }
  const seen = new Set<number>();
  for (const step of steps) {
    if (!Number.isInteger(step.offsetDays) || step.offsetDays < 0) {
      throw new SequenceError("Step offsets must be whole non-negative days.");
    }
    if (seen.has(step.offsetDays)) {
      throw new SequenceError("Each step must use a distinct day offset.");
    }
    seen.add(step.offsetDays);
    const template = transaction
      .select({ id: emailTemplate.id })
      .from(emailTemplate)
      .where(
        and(
          eq(emailTemplate.workspaceId, tenant.workspaceId),
          eq(emailTemplate.id, step.templateId),
        ),
      )
      .get();
    if (!template) throw new SequenceError("Template not found.");
  }
  transaction
    .delete(sequenceStep)
    .where(
      and(
        eq(sequenceStep.workspaceId, tenant.workspaceId),
        eq(sequenceStep.sequenceId, sequenceId),
      ),
    )
    .run();
  return steps
    .slice()
    .sort((left, right) => left.offsetDays - right.offsetDays)
    .map((step) =>
      transaction
        .insert(sequenceStep)
        .values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          sequenceId,
          offsetDays: step.offsetDays,
          templateId: requiredText(step.templateId, "Template", 200),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()!,
    );
}

export function createSequence(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    id?: string;
    name: string;
    steps: SequenceStepInput[];
    now?: Date;
  },
): SequenceListItem {
  return database.transaction((transaction) => {
    const now = input.now ?? new Date();
    const id = input.id ?? randomUUID();
    const name = requiredText(input.name, "Sequence name", 120);
    transaction
      .insert(emailSequence)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        name,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const steps = writeSteps(transaction, tenant, id, input.steps, now);
    logEvent(transaction, tenant, {
      at: now,
      kind: "SEQUENCE_CREATED",
      entityType: "email_sequence",
      entityId: id,
      payload: { stepCount: steps.length },
    });
    return { ...ownedSequence(transaction, tenant, id), steps, enrollmentCount: 0 };
  });
}

export function updateSequence(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: { name?: string; steps?: SequenceStepInput[]; now?: Date },
): SequenceListItem | undefined {
  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(emailSequence)
      .where(
        and(
          eq(emailSequence.workspaceId, tenant.workspaceId),
          eq(emailSequence.id, id),
        ),
      )
      .get();
    if (!existing) return undefined;
    const now = input.now ?? new Date();
    const active = transaction
      .select({ id: sequenceEnrollment.id })
      .from(sequenceEnrollment)
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          eq(sequenceEnrollment.sequenceId, id),
          eq(sequenceEnrollment.status, "active"),
        ),
      )
      .get();
    if (input.steps && active) {
      throw new SequenceError(
        "Stop active enrollments before changing sequence steps.",
      );
    }
    if (input.name !== undefined) {
      transaction
        .update(emailSequence)
        .set({
          name: requiredText(input.name, "Sequence name", 120),
          updatedAt: now,
        })
        .where(
          and(
            eq(emailSequence.workspaceId, tenant.workspaceId),
            eq(emailSequence.id, id),
          ),
        )
        .run();
    }
    if (input.steps) writeSteps(transaction, tenant, id, input.steps, now);
    return getSequence(transaction, tenant, id);
  });
}

export function getSequence(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  id: string,
): SequenceListItem | undefined {
  const row = database
    .select()
    .from(emailSequence)
    .where(
      and(
        eq(emailSequence.workspaceId, tenant.workspaceId),
        eq(emailSequence.id, id),
      ),
    )
    .get();
  if (!row) return undefined;
  const enrollmentCount = database
    .select({ id: sequenceEnrollment.id })
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.sequenceId, id),
        eq(sequenceEnrollment.status, "active"),
      ),
    )
    .all().length;
  return {
    ...row,
    steps: orderedSteps(database, tenant, id),
    enrollmentCount,
  };
}

export function listSequences(
  database: AppDatabase,
  tenant: TenantContext,
): SequenceListItem[] {
  return database
    .select()
    .from(emailSequence)
    .where(eq(emailSequence.workspaceId, tenant.workspaceId))
    .orderBy(asc(emailSequence.name), asc(emailSequence.id))
    .all()
    .map((row) => getSequence(database, tenant, row.id)!)
    .filter(Boolean);
}

export function enrollSequence(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    id?: string;
    sequenceId: string;
    contactId: string;
    opportunityId?: string | null;
    accountId: string;
    threadId?: string | null;
    now?: Date;
  },
): SequenceEnrollment {
  return database.transaction((transaction) => {
    const now = input.now ?? new Date();
    ownedSequence(transaction, tenant, input.sequenceId);
    const steps = orderedSteps(transaction, tenant, input.sequenceId);
    if (steps.length === 0) {
      throw new SequenceError("A sequence needs at least one step.");
    }
    const account = ownedConnectedAccount(transaction, tenant, input.accountId);
    void account;
    const linked = ownedContactEmail(transaction, tenant, input.contactId);
    const opportunityId = input.opportunityId?.trim() || null;
    if (opportunityId) {
      const found = transaction
        .select({ id: opportunity.id })
        .from(opportunity)
        .where(
          and(
            eq(opportunity.workspaceId, tenant.workspaceId),
            eq(opportunity.id, opportunityId),
          ),
        )
        .get();
      if (!found) throw new SequenceError("Opportunity not found.");
    }
    const already = transaction
      .select({ id: sequenceEnrollment.id })
      .from(sequenceEnrollment)
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          eq(sequenceEnrollment.sequenceId, input.sequenceId),
          eq(sequenceEnrollment.contactId, input.contactId),
          eq(sequenceEnrollment.status, "active"),
        ),
      )
      .get();
    if (already) {
      throw new SequenceError("This contact is already enrolled in this sequence.");
    }
    const first = steps[0]!;
    const id = input.id ?? randomUUID();
    const timeZone = workspaceZone(transaction, tenant);
    const row = transaction
      .insert(sequenceEnrollment)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        sequenceId: input.sequenceId,
        contactId: input.contactId,
        opportunityId,
        accountId: input.accountId,
        currentStepId: first.id,
        threadId: input.threadId?.trim() || null,
        status: "active",
        cancelReason: null,
        nextAt: sequenceStepDueAt(now, first.offsetDays, timeZone),
        threadProvenAt: null,
        enrolledAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()!;
    logEvent(transaction, tenant, {
      at: now,
      kind: "SEQUENCE_ENROLLED",
      entityType: "sequence_enrollment",
      entityId: id,
      payload: {
        sequenceId: input.sequenceId,
        contactId: input.contactId,
        accountId: input.accountId,
        recipient: linked.recipient,
      },
    });
    return row;
  });
}

function voidEnrollmentQueueRows(
  transaction: AppTransaction,
  tenant: TenantContext,
  enrollmentId: string,
  now: Date,
  lastError: string,
): void {
  transaction
    .update(sendQueue)
    .set({
      status: "cancelled",
      approvalHash: null,
      approvedAt: null,
      approvalKind: null,
      lastError,
      updatedAt: now,
    })
    .where(
      and(
        eq(sendQueue.workspaceId, tenant.workspaceId),
        eq(sendQueue.enrollmentId, enrollmentId),
        inArray(sendQueue.status, [
          "awaiting_approval",
          "approved",
          "held",
          "failed",
        ]),
      ),
    )
    .run();
}

export function cancelEnrollmentInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
  reason: SequenceCancelReason,
  now: Date,
): SequenceEnrollment {
  if (enrollment.status !== "active") return enrollment;
  const updated = transaction
    .update(sequenceEnrollment)
    .set({
      status: "cancelled",
      cancelReason: reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.id, enrollment.id),
        eq(sequenceEnrollment.status, "active"),
      ),
    )
    .returning()
    .get()!;
  voidEnrollmentQueueRows(
    transaction,
    tenant,
    enrollment.id,
    now,
    SEQUENCE_CANCEL_COPY[reason],
  );
  logEvent(transaction, tenant, {
    at: now,
    kind: "SEQUENCE_CANCELLED",
    entityType: "sequence_enrollment",
    entityId: enrollment.id,
    payload: { reason },
  });
  return updated;
}

export function stopEnrollment(
  database: AppDatabase,
  tenant: TenantContext,
  enrollmentId: string,
  now = new Date(),
): SequenceEnrollment | undefined {
  return database.transaction((transaction) => {
    const row = transaction
      .select()
      .from(sequenceEnrollment)
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          eq(sequenceEnrollment.id, enrollmentId),
        ),
      )
      .get();
    if (!row) return undefined;
    return cancelEnrollmentInTransaction(
      transaction,
      tenant,
      row,
      "manual_stop",
      now,
    );
  });
}

function latestInboundReplyAt(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
): Date | null {
  const row = transaction
    .select({ occurredAt: interaction.occurredAt })
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.contactId, contactId),
        eq(interaction.direction, "inbound"),
      ),
    )
    .orderBy(asc(interaction.occurredAt))
    .all()
    .at(-1);
  return row?.occurredAt ?? null;
}

export function evaluateEnrollmentCancelInTransaction(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
  claimAt: Date,
): SequenceCancelReason | null {
  if (enrollment.status === "cancelled") {
    return enrollment.cancelReason ?? "manual_stop";
  }
  const linked = ownedContactEmail(transaction, tenant, enrollment.contactId);
  const blocked = suppressionForRecipientInTransaction(
    transaction,
    tenant,
    linked.recipient,
    enrollment.contactId,
  );
  const opportunityRow = enrollment.opportunityId
    ? transaction
        .select()
        .from(opportunity)
        .where(
          and(
            eq(opportunity.workspaceId, tenant.workspaceId),
            eq(opportunity.id, enrollment.opportunityId),
          ),
        )
        .get()
    : null;
  const applicationRow = enrollment.opportunityId
    ? transaction
        .select({ stage: application.stage })
        .from(application)
        .where(
          and(
            eq(application.workspaceId, tenant.workspaceId),
            eq(application.opportunityId, enrollment.opportunityId),
          ),
        )
        .get()
    : null;
  const referralConditions = [
    eq(referralRequest.workspaceId, tenant.workspaceId),
    eq(referralRequest.contactId, enrollment.contactId),
  ];
  if (enrollment.opportunityId) {
    referralConditions.push(
      eq(referralRequest.opportunityId, enrollment.opportunityId),
    );
  }
  const referralRow = transaction
    .select({ stage: referralRequest.stage })
    .from(referralRequest)
    .where(and(...referralConditions))
    .all()
    .find((row) => row.stage === "referral_received");
  return detectSequenceCancel({
    claimAt,
    replyAt: latestInboundReplyAt(transaction, tenant, enrollment.contactId),
    bounced: blocked?.reason === "bounced",
    doNotContact:
      linked.contact.networkingStatus === DO_NOT_CONTACT ||
      blocked?.reason === "do_not_contact",
    opportunityClosed: opportunityRow
      ? TERMINAL_OPPORTUNITY.has(opportunityRow.stage)
      : false,
    applicationRejected: applicationRow?.stage === "rejected",
    referralReceived:
      opportunityRow?.stage === "referral_received" || Boolean(referralRow),
    manualStop: false,
  });
}

export function accountRecoveryOpen(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  accountId: string,
): boolean {
  return Boolean(
    transaction
      .select({ id: gmailRecoveryGeneration.id })
      .from(gmailRecoveryGeneration)
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.accountId, accountId),
          inArray(gmailRecoveryGeneration.status, ["sweeping", "catching_up"]),
        ),
      )
      .get(),
  );
}

export function enrollmentFreshness(
  transaction: AppTransaction,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
  now: Date,
) {
  const account = transaction
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, enrollment.accountId),
      ),
    )
    .get();
  return sequenceMailboxFreshness({
    accountStatus: account?.status ?? "disconnected",
    sequenceSafeAt: account?.sequenceSafeAt ?? null,
    enrolledAt: enrollment.enrolledAt,
    threadId: enrollment.threadId,
    threadProvenAt: enrollment.threadProvenAt,
    recoveryOpen: account
      ? accountRecoveryOpen(transaction, tenant, account.id)
      : false,
    now,
  });
}

export function proveEnrollmentThread(
  database: AppDatabase,
  tenant: TenantContext,
  threadId: string,
  now = new Date(),
): void {
  database
    .update(sequenceEnrollment)
    .set({ threadProvenAt: now, updatedAt: now })
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.threadId, threadId),
        eq(sequenceEnrollment.status, "active"),
        lte(sequenceEnrollment.enrolledAt, now),
      ),
    )
    .run();
}

function renderStepPayload(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
  step: SequenceStep,
): {
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  recipient: string;
  contactName: string;
  accountEmail: string;
  attachments: { id: string; name: string }[];
} {
  const template = transaction
    .select()
    .from(emailTemplate)
    .where(
      and(
        eq(emailTemplate.workspaceId, tenant.workspaceId),
        eq(emailTemplate.id, step.templateId),
      ),
    )
    .get();
  if (!template) throw new SequenceError("Template not found.");
  const linked = ownedContactEmail(transaction, tenant, enrollment.contactId);
  const account = transaction
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, enrollment.accountId),
      ),
    )
    .get();
  if (!account) throw new SequenceError("Gmail account not found.");
  const opportunityRow = enrollment.opportunityId
    ? transaction
        .select()
        .from(opportunity)
        .where(
          and(
            eq(opportunity.workspaceId, tenant.workspaceId),
            eq(opportunity.id, enrollment.opportunityId),
          ),
        )
        .get()
    : null;
  const companyName = opportunityRow
    ? transaction
        .select({ name: company.name })
        .from(company)
        .where(
          and(
            eq(company.workspaceId, tenant.workspaceId),
            eq(company.id, opportunityRow.companyId),
          ),
        )
        .get()?.name
    : linked.contact.companyId
      ? transaction
          .select({ name: company.name })
          .from(company)
          .where(
            and(
              eq(company.workspaceId, tenant.workspaceId),
              eq(company.id, linked.contact.companyId),
            ),
          )
          .get()?.name
      : undefined;
  const workspaceSettings = transaction
    .select()
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  const attachmentId = template.defaultDocumentVersionId;
  const attachment = attachmentId
    ? transaction
        .select()
        .from(documentVersion)
        .where(
          and(
            eq(documentVersion.workspaceId, tenant.workspaceId),
            eq(documentVersion.id, attachmentId),
          ),
        )
        .get()
    : null;
  const nameParts = linked.contact.name.trim().split(/\s+/);
  const rendered = renderEmailTemplate(
    { subject: template.subject, body: template.body },
    {
      first_name: nameParts[0],
      last_name: nameParts.slice(1).join(" ") || undefined,
      company: companyName,
      job_title: opportunityRow?.role,
      job_id: opportunityRow?.jobId ?? undefined,
      job_url: opportunityRow?.url ?? undefined,
      my_name: workspaceSettings?.displayName || undefined,
      my_university: workspaceSettings?.university ?? undefined,
      resume_name: attachment?.label,
    },
  );
  const body = [rendered.body, account.signature?.trim()].filter(Boolean).join("\n\n");
  return {
    subject: rendered.subject,
    body,
    attachmentVersionIds: attachment ? [attachment.id] : [],
    recipient: linked.recipient,
    contactName: linked.contact.name,
    accountEmail: account.email,
    attachments: attachment
      ? [{ id: attachment.id, name: attachment.label }]
      : [],
  };
}

function reviewFromEnrollment(
  transaction: AppTransaction | AppDatabase,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
): SequenceReview {
  const step = transaction
    .select()
    .from(sequenceStep)
    .where(
      and(
        eq(sequenceStep.workspaceId, tenant.workspaceId),
        eq(sequenceStep.id, enrollment.currentStepId),
      ),
    )
    .get();
  if (!step) throw new SequenceError("Sequence step not found.");
  const payload = renderStepPayload(transaction, tenant, enrollment, step);
  const queueId = sequenceQueueRowId(enrollment.id, step.id);
  const queued = getQueueMessage(transaction as AppDatabase, tenant, queueId);
  return {
    id: queued?.id ?? sequenceDueSourceKey(enrollment.id, step.id),
    sourceKey: sequenceDueSourceKey(enrollment.id, step.id),
    enrollmentId: enrollment.id,
    stepId: step.id,
    origin: "sequence",
    status:
      queued?.status === "held" || queued?.status === "approved"
        ? queued.status
        : "awaiting_approval",
    accountId: queued?.accountId ?? enrollment.accountId,
    accountEmail: payload.accountEmail,
    contactId: enrollment.contactId,
    contactName: payload.contactName,
    recipient: queued?.recipient ?? payload.recipient,
    subject: queued?.subject ?? payload.subject,
    body: queued?.body ?? payload.body,
    attachmentVersionIds:
      queued?.attachmentVersionIdsJson ?? payload.attachmentVersionIds,
    attachments: payload.attachments,
    sendAt: queued?.sendAt ?? enrollment.nextAt,
    sentAt: queued?.sentAt ?? null,
    lastError: queued?.lastError ?? null,
    approvalRequired: true,
    sendAnywayAvailable: false,
  };
}

export function getSequenceReview(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): SequenceReview | undefined {
  const parsed = parseSequenceDueSourceKey(id);
  const queue = getQueueMessage(database, tenant, id);
  const enrollmentId = parsed?.enrollmentId ?? queue?.enrollmentId;
  if (!enrollmentId) return undefined;
  const enrollment = database
    .select()
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.id, enrollmentId),
      ),
    )
    .get();
  if (!enrollment || enrollment.status !== "active") return undefined;
  if (parsed && parsed.stepId !== enrollment.currentStepId) return undefined;
  return reviewFromEnrollment(database, tenant, enrollment);
}

function upsertSequenceQueueRow(
  database: AppDatabase,
  tenant: TenantContext,
  enrollment: SequenceEnrollment,
  review: SequenceReview,
  input: {
    accountId?: string;
    subject?: string;
    body?: string;
    attachmentVersionIds?: string[];
    sendAt: Date;
    approve: boolean;
    now: Date;
  },
) {
  const accountId = input.accountId ?? review.accountId;
  if (accountId !== enrollment.accountId) {
    database
      .update(sequenceEnrollment)
      .set({ accountId, updatedAt: input.now })
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          eq(sequenceEnrollment.id, enrollment.id),
        ),
      )
      .run();
  }
  const queueId = sequenceQueueRowId(enrollment.id, review.stepId);
  const existing = getQueueMessage(database, tenant, queueId);
  const subject = input.subject ?? review.subject;
  const body = input.body ?? review.body;
  const attachmentVersionIds =
    input.attachmentVersionIds ?? review.attachmentVersionIds;
  if (existing) {
    const updated = updateQueueMessage(database, tenant, queueId, {
      accountId,
      subject,
      body,
      attachmentVersionIds,
      sendAt: input.sendAt,
    }, input.now);
    if (!updated) throw new SequenceError("Queue row not found.");
  } else {
    createQueueMessage(database, tenant, {
      id: queueId,
      accountId,
      contactId: enrollment.contactId,
      opportunityId: enrollment.opportunityId,
      origin: "sequence",
      subject,
      body,
      attachmentVersionIds,
      sendAt: input.sendAt,
      enrollmentId: enrollment.id,
      stepId: review.stepId,
      now: input.now,
    });
  }
  if (!input.approve) {
    return getQueueMessage(database, tenant, queueId)!;
  }
  return approveQueueMessage(database, tenant, queueId, {
    sendAt: input.sendAt,
    now: input.now,
  })!;
}

export function saveSequenceReview(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: {
    accountId?: string;
    subject?: string;
    body?: string;
    attachmentVersionIds?: string[];
    sendAt: Date;
    approve: boolean;
    requestKeys?: string[];
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  if (sequenceRequestGrantsOverride("sequence", input.requestKeys ?? [])) {
    throw new SequenceError(
      "Sequence messages cannot skip the mailbox freshness check.",
    );
  }
  const review = getSequenceReview(database, tenant, id);
  if (!review) return undefined;
  const enrollment = database
    .select()
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.id, review.enrollmentId),
      ),
    )
    .get();
  if (!enrollment) return undefined;
  const reason = database.transaction((transaction) =>
    evaluateEnrollmentCancelInTransaction(transaction, tenant, enrollment, now),
  );
  if (reason) {
    database.transaction((transaction) => {
      cancelEnrollmentInTransaction(transaction, tenant, enrollment, reason, now);
    });
    throw new SequenceError(SEQUENCE_CANCEL_COPY[reason]);
  }
  return upsertSequenceQueueRow(database, tenant, enrollment, review, {
    ...input,
    now,
  });
}

export function listDueSequenceItemsInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
) {
  const timeZone = workspaceZone(transaction, tenant);
  const now = new Date();
  const enrollments = transaction
    .select()
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.status, "active"),
      ),
    )
    .all();
  const items: Array<{
    sourceKey: string;
    origin: "derived";
    title: string;
    dueOn: string | null;
    entityType: "contact";
    entityId: string;
    entityLabel: string;
    taskId: null;
    derivedFromKey: null;
    priority: null;
    status: null;
  }> = [];
  for (const enrollment of enrollments) {
    if (evaluateEnrollmentCancelInTransaction(transaction, tenant, enrollment, now)) {
      continue;
    }
    const linked = transaction
      .select({ name: contact.name })
      .from(contact)
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          eq(contact.id, enrollment.contactId),
        ),
      )
      .get();
    items.push({
      sourceKey: sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      origin: "derived",
      title: REVIEW_FOLLOW_UP_EMAIL,
      dueOn: calendarDateInZone(timeZone, enrollment.nextAt),
      entityType: "contact",
      entityId: enrollment.contactId,
      entityLabel: linked?.name ?? "Contact",
      taskId: null,
      derivedFromKey: null,
      priority: null,
      status: null,
    });
  }
  return items;
}

export function listOutreachQueue(
  database: AppDatabase,
  tenant: TenantContext,
  now = new Date(),
) {
  const queued = listQueueSummaries(database, tenant);
  const queuedKeys = new Set(
    database
      .select({
        enrollmentId: sendQueue.enrollmentId,
        stepId: sendQueue.stepId,
      })
      .from(sendQueue)
      .where(
        and(
          eq(sendQueue.workspaceId, tenant.workspaceId),
          eq(sendQueue.origin, "sequence"),
        ),
      )
      .all()
      .filter((row) => row.enrollmentId && row.stepId)
      .map((row) => sequenceDueSourceKey(row.enrollmentId!, row.stepId!)),
  );
  const derived = database
    .select()
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.status, "active"),
        lte(sequenceEnrollment.nextAt, now),
      ),
    )
    .all()
    .flatMap((enrollment) => {
      if (evaluateEnrollmentCancelInTransaction(database, tenant, enrollment, now)) {
        return [];
      }
      const key = sequenceDueSourceKey(enrollment.id, enrollment.currentStepId);
      if (queuedKeys.has(key)) return [];
      const review = reviewFromEnrollment(database, tenant, enrollment);
      return [
        {
          id: review.id,
          accountId: review.accountId,
          accountEmail: review.accountEmail,
          contactId: review.contactId,
          contactName: review.contactName,
          origin: "sequence" as const,
          status: review.status,
          subject: REVIEW_FOLLOW_UP_EMAIL,
          sendAt: review.sendAt,
          sentAt: review.sentAt,
          lastError: review.lastError,
        },
      ];
    });
  return [...queued, ...derived].sort(
    (left, right) =>
      left.sendAt.valueOf() - right.sendAt.valueOf() ||
      left.id.localeCompare(right.id),
  );
}

export function listAccountsWithDueApprovedSequence(
  database: AppDatabase,
  now: Date,
): Array<{ workspaceId: string; accountId: string }> {
  const rows = database
    .select({
      workspaceId: sendQueue.workspaceId,
      accountId: sendQueue.accountId,
    })
    .from(sendQueue)
    .where(
      and(
        eq(sendQueue.origin, "sequence"),
        lte(sendQueue.sendAt, now),
        or(
          eq(sendQueue.status, "approved"),
          and(
            eq(sendQueue.status, "held"),
            sql`${sendQueue.approvalHash} is not null`,
            eq(sendQueue.lastError, HELD_MAILBOX_UNPROVEN),
          ),
        ),
      ),
    )
    .all();
  const seen = new Set<string>();
  const unique: Array<{ workspaceId: string; accountId: string }> = [];
  for (const row of rows) {
    const key = `${row.workspaceId}:${row.accountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

export function advanceEnrollmentAfterSend(
  transaction: AppTransaction,
  tenant: TenantContext,
  enrollmentId: string,
  threadId: string | null,
  now: Date,
): void {
  const enrollment = transaction
    .select()
    .from(sequenceEnrollment)
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.id, enrollmentId),
        eq(sequenceEnrollment.status, "active"),
      ),
    )
    .get();
  if (!enrollment) return;
  const steps = orderedSteps(transaction, tenant, enrollment.sequenceId);
  const currentIndex = steps.findIndex((step) => step.id === enrollment.currentStepId);
  const next = currentIndex >= 0 ? steps[currentIndex + 1] : undefined;
  const timeZone = workspaceZone(transaction, tenant);
  if (!next) {
    transaction
      .update(sequenceEnrollment)
      .set({
        status: "completed",
        threadId: threadId ?? enrollment.threadId,
        threadProvenAt: threadId ? now : enrollment.threadProvenAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          eq(sequenceEnrollment.id, enrollment.id),
        ),
      )
      .run();
    return;
  }
  transaction
    .update(sequenceEnrollment)
    .set({
      currentStepId: next.id,
      nextAt: sequenceStepDueAt(enrollment.enrolledAt, next.offsetDays, timeZone),
      threadId: threadId ?? enrollment.threadId,
      threadProvenAt: threadId ? now : enrollment.threadProvenAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
        eq(sequenceEnrollment.id, enrollment.id),
      ),
    )
    .run();
}

export function listEnrollments(
  database: AppDatabase,
  tenant: TenantContext,
  filter: { contactId?: string; opportunityId?: string } = {},
): SequenceEnrollment[] {
  const conditions = [eq(sequenceEnrollment.workspaceId, tenant.workspaceId)];
  if (filter.contactId) {
    conditions.push(eq(sequenceEnrollment.contactId, filter.contactId));
  }
  if (filter.opportunityId) {
    conditions.push(eq(sequenceEnrollment.opportunityId, filter.opportunityId));
  }
  return database
    .select()
    .from(sequenceEnrollment)
    .where(and(...conditions))
    .orderBy(asc(sequenceEnrollment.createdAt), asc(sequenceEnrollment.id))
    .all();
}

export { HELD_MAILBOX_UNPROVEN, REVIEW_FOLLOW_UP_EMAIL, SEQUENCE_CANCEL_COPY };
