import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import {
  UNCERTAIN_DELIVERY_ERROR,
  hashSendPayload,
  queueMessageId,
  tomorrowMorningSlot,
} from "../../domain/send-safety";
import { calendarDateInZone } from "../../domain/referral";
import { zonedInterviewAt } from "../../domain/interview";
import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  contact,
  contactMethod,
  emailAccount,
  emailMessage,
  opportunity,
  referralRequest,
  sendQueue,
  settings,
  suppressionEntry,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type QueueOrigin = "one_off" | "sequence" | "self_digest";
export type QueueStatus =
  | "awaiting_approval"
  | "approved"
  | "claimed"
  | "sent"
  | "failed"
  | "held"
  | "cancelled";
export type SuppressionReason =
  | "do_not_contact"
  | "invalid_email"
  | "unsubscribed"
  | "bounced"
  | "asked_not_to_follow_up"
  | "manual";

export type QueueMessage = typeof sendQueue.$inferSelect;
export type SuppressionEntry = typeof suppressionEntry.$inferSelect;

export type CreateQueueMessageInput = {
  id?: string;
  accountId: string;
  contactId?: string | null;
  opportunityId?: string | null;
  referralId?: string | null;
  recipient?: string;
  origin: QueueOrigin;
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  sendAt: Date;
  approvalKind?: "owner_click" | "self_digest_policy";
  enrollmentId?: string | null;
  stepId?: string | null;
  now?: Date;
};

export class SendSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendSafetyError";
  }
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new SendSafetyError(`${label} is required.`);
  if (normalized.length > maximum) {
    throw new SendSafetyError(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function validInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new SendSafetyError(`${label} must be a valid instant.`);
  }
  return value;
}

function attachmentIds(values: string[]): string[] {
  if (!Array.isArray(values)) {
    throw new SendSafetyError("Attachment versions must be a list.");
  }
  const result = values.map((value) => requiredText(value, "Attachment version", 200));
  if (new Set(result).size !== result.length) {
    throw new SendSafetyError("An attachment version cannot be repeated.");
  }
  return result;
}

function ownedAccount(
  transaction: AppTransaction,
  tenant: TenantContext,
  accountId: string,
) {
  const account = transaction
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  if (!account) throw new SendSafetyError("Gmail account not found.");
  if (account.status !== "connected") {
    throw new SendSafetyError("The selected Gmail account is disconnected.");
  }
  return account;
}

function ownedContactRecipient(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
) {
  const row = transaction
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.id, contactId),
      ),
    )
    .get();
  if (!row) throw new SendSafetyError("Contact not found.");
  const methods = transaction
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
    .all();
  const selected = methods.find((method) => method.isPrimary) ?? methods[0];
  if (!selected) throw new SendSafetyError("This contact has no valid email address.");
  return { contact: row, recipient: selected.valueNormalized };
}

function requireOwnedLinks(
  transaction: AppTransaction,
  tenant: TenantContext,
  opportunityId: string | null,
  referralId: string | null,
): void {
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
    if (!found) throw new SendSafetyError("Opportunity not found.");
  }
  if (referralId) {
    const found = transaction
      .select({ id: referralRequest.id })
      .from(referralRequest)
      .where(
        and(
          eq(referralRequest.workspaceId, tenant.workspaceId),
          eq(referralRequest.id, referralId),
        ),
      )
      .get();
    if (!found) throw new SendSafetyError("Referral not found.");
  }
}

export function suppressionForRecipientInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
  contactId: string | null,
): { reason: SuppressionReason; message: string } | null {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return { reason: "invalid_email", message: "The recipient email is invalid." };
  }
  const suppression = transaction
    .select({ reason: suppressionEntry.reason })
    .from(suppressionEntry)
    .where(
      and(
        eq(suppressionEntry.workspaceId, tenant.workspaceId),
        eq(suppressionEntry.email, normalized),
      ),
    )
    .orderBy(asc(suppressionEntry.at), asc(suppressionEntry.id))
    .get();
  if (suppression) {
    return {
      reason: suppression.reason,
      message: `Email is blocked by ${suppression.reason.replaceAll("_", " ")} suppression.`,
    };
  }
  if (contactId) {
    const linked = transaction
      .select({ status: contact.networkingStatus })
      .from(contact)
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          eq(contact.id, contactId),
        ),
      )
      .get();
    if (!linked) return { reason: "do_not_contact", message: "Contact not found." };
    if (linked.status === "do_not_contact") {
      return {
        reason: "do_not_contact",
        message: "This contact is marked Do Not Contact. Email is blocked.",
      };
    }
  }
  return null;
}

export function getSuppressionBlock(
  database: AppDatabase,
  tenant: TenantContext,
  email: string,
  contactId: string | null = null,
) {
  return database.transaction((transaction) =>
    suppressionForRecipientInTransaction(transaction, tenant, email, contactId),
  );
}

function assertNotSuppressed(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
  contactId: string | null,
) {
  const blocked = suppressionForRecipientInTransaction(
    transaction,
    tenant,
    email,
    contactId,
  );
  if (blocked) throw new SendSafetyError(blocked.message);
}

function currentPayload(row: QueueMessage) {
  return {
    recipient: row.recipient,
    accountId: row.accountId,
    subject: row.subject,
    body: row.body,
    attachmentVersionIds: row.attachmentVersionIdsJson,
    sendAt: row.sendAt,
  };
}

export function createQueueMessage(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateQueueMessageInput,
): QueueMessage {
  return database.transaction((transaction) => {
    const id = input.id ?? randomUUID();
    const now = input.now ?? new Date();
    const accountId = requiredText(input.accountId, "Gmail account", 200);
    const account = ownedAccount(transaction, tenant, accountId);
    const contactId = input.contactId?.trim() || null;
    const linked = contactId
      ? ownedContactRecipient(transaction, tenant, contactId)
      : null;
    const recipient = normalizeEmail(linked?.recipient ?? input.recipient ?? "");
    if (!recipient) throw new SendSafetyError("Recipient must be a valid email address.");
    if (input.origin !== "self_digest" && !contactId) {
      throw new SendSafetyError("Contact is required for third-party mail.");
    }
    if (input.origin === "self_digest" && recipient !== account.email) {
      throw new SendSafetyError("A self digest can only be sent to its Gmail account.");
    }
    if (input.origin === "sequence" && input.approvalKind) {
      throw new SendSafetyError("Sequence messages begin awaiting approval.");
    }
    const opportunityId = input.opportunityId?.trim() || null;
    const referralId = input.referralId?.trim() || null;
    requireOwnedLinks(transaction, tenant, opportunityId, referralId);
    assertNotSuppressed(transaction, tenant, recipient, contactId);
    const subject = requiredText(input.subject, "Subject", 998);
    if (/\r|\n/.test(subject)) {
      throw new SendSafetyError("Subject must stay on one line.");
    }
    const body = requiredText(input.body, "Message", 500_000);
    const attachments = attachmentIds(input.attachmentVersionIds);
    const sendAt = validInstant(input.sendAt, "Send time");
    const payloadHash = hashSendPayload({
      recipient,
      accountId,
      subject,
      body,
      attachmentVersionIds: attachments,
      sendAt,
    });
    const approved = input.approvalKind !== undefined;
    const row = transaction
      .insert(sendQueue)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        accountId,
        contactId,
        opportunityId,
        referralId,
        enrollmentId: input.enrollmentId?.trim() || null,
        stepId: input.stepId?.trim() || null,
        origin: input.origin,
        status: approved ? "approved" : "awaiting_approval",
        recipient,
        subject,
        body,
        attachmentVersionIdsJson: attachments,
        sendAt,
        payloadHash,
        approvalHash: approved ? payloadHash : null,
        approvedAt: approved ? now : null,
        approvalKind: input.approvalKind ?? null,
        messageId: queueMessageId(id, account.email),
        claimedAt: null,
        attempts: 0,
        lastError: null,
        gmailMessageId: null,
        gmailThreadId: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind: "SEND_QUEUED",
      entityType: "send_queue",
      entityId: id,
      payload: { accountId, contactId, origin: input.origin, status: row.status },
    });
    return row;
  });
}

export function getQueueMessage(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): QueueMessage | undefined {
  return database
    .select()
    .from(sendQueue)
    .where(
      and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
    )
    .get();
}

export function listQueueMessages(
  database: AppDatabase,
  tenant: TenantContext,
  status?: QueueStatus,
): QueueMessage[] {
  const conditions = [eq(sendQueue.workspaceId, tenant.workspaceId)];
  if (status) conditions.push(eq(sendQueue.status, status));
  return database
    .select()
    .from(sendQueue)
    .where(and(...conditions))
    .orderBy(asc(sendQueue.sendAt), asc(sendQueue.id))
    .all();
}

export function listQueueSummaries(
  database: AppDatabase,
  tenant: TenantContext,
) {
  return database
    .select({
      id: sendQueue.id,
      accountId: sendQueue.accountId,
      accountEmail: emailAccount.email,
      contactId: sendQueue.contactId,
      contactName: contact.name,
      origin: sendQueue.origin,
      status: sendQueue.status,
      subject: sendQueue.subject,
      sendAt: sendQueue.sendAt,
      sentAt: sendQueue.sentAt,
      lastError: sendQueue.lastError,
    })
    .from(sendQueue)
    .innerJoin(
      emailAccount,
      and(
        eq(emailAccount.workspaceId, sendQueue.workspaceId),
        eq(emailAccount.id, sendQueue.accountId),
      ),
    )
    .leftJoin(
      contact,
      and(
        eq(contact.workspaceId, sendQueue.workspaceId),
        eq(contact.id, sendQueue.contactId),
      ),
    )
    .where(eq(sendQueue.workspaceId, tenant.workspaceId))
    .orderBy(asc(sendQueue.sendAt), asc(sendQueue.id))
    .all();
}

export function queueAccountUsage(
  database: AppDatabase,
  tenant: TenantContext,
  now = new Date(),
) {
  const timeZone = database
    .select({ value: settings.timezone })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get()?.value;
  if (!timeZone) return [];
  const dateOn = calendarDateInZone(timeZone, now);
  return database
    .select({
      id: emailAccount.id,
      email: emailAccount.email,
      dailyLimit: emailAccount.dailyLimit,
    })
    .from(emailAccount)
    .where(eq(emailAccount.workspaceId, tenant.workspaceId))
    .orderBy(asc(emailAccount.createdAt), asc(emailAccount.id))
    .all()
    .map((account) => ({
      ...account,
      sentToday: database
        .select({ sentAt: emailMessage.sentAt })
        .from(emailMessage)
        .where(
          and(
            eq(emailMessage.workspaceId, tenant.workspaceId),
            eq(emailMessage.accountId, account.id),
            eq(emailMessage.direction, "outbound"),
          ),
        )
        .all()
        .filter((row) => calendarDateInZone(timeZone, row.sentAt) === dateOn)
        .length,
    }));
}

export function listSuppressionEntries(
  database: AppDatabase,
  tenant: TenantContext,
): SuppressionEntry[] {
  return database
    .select()
    .from(suppressionEntry)
    .where(eq(suppressionEntry.workspaceId, tenant.workspaceId))
    .orderBy(asc(suppressionEntry.email), asc(suppressionEntry.at))
    .all();
}

export function setQueueMessageState(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  action: "hold" | "cancel",
  now = new Date(),
): QueueMessage | undefined {
  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(sendQueue)
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .get();
    if (!existing) return undefined;
    if (existing.status === "sent") {
      throw new SendSafetyError("A sent queue row cannot be changed.");
    }
    const cancelled = action === "cancel";
    return transaction
      .update(sendQueue)
      .set({
        status: cancelled ? "cancelled" : "held",
        approvalHash: cancelled ? null : existing.approvalHash,
        approvedAt: cancelled ? null : existing.approvedAt,
        approvalKind: cancelled ? null : existing.approvalKind,
        claimedAt: null,
        lastError: cancelled ? "Cancelled by workspace owner." : "Held by workspace owner.",
        updatedAt: now,
      })
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .returning()
      .get();
  });
}

export function tomorrowMorningQueueTime(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  now = new Date(),
): Date {
  const account = database
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  const workspaceSettings = database
    .select({ timeZone: settings.timezone })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  if (!account || !workspaceSettings) {
    throw new SendSafetyError("Gmail account not found.");
  }
  const first = tomorrowMorningSlot({
    timeZone: workspaceSettings.timeZone,
    now,
    windowStart: account.sendingWindowStart,
    windowEnd: account.sendingWindowEnd,
    ordinal: 0,
  });
  const targetDate = calendarDateInZone(workspaceSettings.timeZone, first);
  const ordinal = database
    .select({ sendAt: sendQueue.sendAt })
    .from(sendQueue)
    .where(
      and(
        eq(sendQueue.workspaceId, tenant.workspaceId),
        eq(sendQueue.accountId, accountId),
        notInArray(sendQueue.status, ["cancelled", "sent"]),
      ),
    )
    .all()
    .filter(
      (row) => calendarDateInZone(workspaceSettings.timeZone, row.sendAt) === targetDate,
    ).length;
  return tomorrowMorningSlot({
    timeZone: workspaceSettings.timeZone,
    now,
    windowStart: account.sendingWindowStart,
    windowEnd: account.sendingWindowEnd,
    ordinal,
  });
}

export function tonightQueueTime(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  now = new Date(),
): Date {
  const account = database
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  const workspaceSettings = database
    .select({ timeZone: settings.timezone })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  if (!account || !workspaceSettings) {
    throw new SendSafetyError("Gmail account not found.");
  }
  const dateOn = calendarDateInZone(workspaceSettings.timeZone, now);
  const weekday = new Date(`${dateOn}T00:00:00.000Z`).getUTCDay();
  const baseMinute = Math.max(
    account.sendingWindowStart,
    account.sendingWindowEnd - 60,
  );
  const existing = database
    .select({ sendAt: sendQueue.sendAt })
    .from(sendQueue)
    .where(
      and(
        eq(sendQueue.workspaceId, tenant.workspaceId),
        eq(sendQueue.accountId, accountId),
        notInArray(sendQueue.status, ["cancelled", "sent"]),
      ),
    )
    .all()
    .filter(
      (row) => calendarDateInZone(workspaceSettings.timeZone, row.sendAt) === dateOn,
    ).length;
  const minute = baseMinute + existing * 2;
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  const candidate =
    weekday !== 0 && weekday !== 6 && minute < account.sendingWindowEnd
      ? zonedInterviewAt(workspaceSettings.timeZone, dateOn, `${hh}:${mm}`)
      : null;
  return candidate && candidate.valueOf() > now.valueOf()
    ? candidate
    : tomorrowMorningQueueTime(database, tenant, accountId, now);
}

export function parseWorkspaceSendAt(
  database: AppDatabase,
  tenant: TenantContext,
  value: string,
): Date {
  const timeZone = database
    .select({ value: settings.timezone })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get()?.value;
  if (!timeZone) throw new SendSafetyError("Workspace settings not found.");
  const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? zonedInterviewAt(timeZone, value.slice(0, 10), value.slice(11))
    : new Date(value);
  if (Number.isNaN(instant.valueOf())) {
    throw new SendSafetyError("Send time must be a valid instant.");
  }
  return instant;
}

export type UpdateQueueMessageInput = Partial<{
  accountId: string;
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  sendAt: Date;
}>;

export function updateQueueMessage(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: UpdateQueueMessageInput,
  now = new Date(),
): QueueMessage | undefined {
  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(sendQueue)
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .get();
    if (!existing) return undefined;
    if (existing.status === "sent" || existing.status === "cancelled") {
      throw new SendSafetyError("This queue row can no longer be edited.");
    }
    const accountId = input.accountId
      ? requiredText(input.accountId, "Gmail account", 200)
      : existing.accountId;
    ownedAccount(transaction, tenant, accountId);
    const subject = input.subject === undefined
      ? existing.subject
      : requiredText(input.subject, "Subject", 998);
    if (/\r|\n/.test(subject)) throw new SendSafetyError("Subject must stay on one line.");
    const body = input.body === undefined
      ? existing.body
      : requiredText(input.body, "Message", 500_000);
    const attachments = input.attachmentVersionIds === undefined
      ? existing.attachmentVersionIdsJson
      : attachmentIds(input.attachmentVersionIds);
    const sendAt = input.sendAt === undefined
      ? existing.sendAt
      : validInstant(input.sendAt, "Send time");
    assertNotSuppressed(transaction, tenant, existing.recipient, existing.contactId);
    const payloadHash = hashSendPayload({
      recipient: existing.recipient,
      accountId,
      subject,
      body,
      attachmentVersionIds: attachments,
      sendAt,
    });
    return transaction
      .update(sendQueue)
      .set({
        accountId,
        subject,
        body,
        attachmentVersionIdsJson: attachments,
        sendAt,
        payloadHash,
        approvalHash: null,
        approvedAt: null,
        approvalKind: null,
        status: "awaiting_approval",
        claimedAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .returning()
      .get();
  });
}

export function approveQueueMessage(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  input: {
    sendAt?: Date;
    now?: Date;
    uncertainDeliveryAcknowledged?: boolean;
  } = {},
): QueueMessage | undefined {
  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(sendQueue)
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .get();
    if (!existing) return undefined;
    if (["sent", "cancelled", "claimed"].includes(existing.status)) {
      throw new SendSafetyError("This queue row cannot be approved.");
    }
    if (
      existing.lastError === UNCERTAIN_DELIVERY_ERROR &&
      input.uncertainDeliveryAcknowledged !== true
    ) {
      throw new SendSafetyError(
        "Check Gmail Sent before approving a new attempt.",
      );
    }
    ownedAccount(transaction, tenant, existing.accountId);
    assertNotSuppressed(transaction, tenant, existing.recipient, existing.contactId);
    const sendAt = input.sendAt
      ? validInstant(input.sendAt, "Send time")
      : existing.sendAt;
    const payloadHash = hashSendPayload({ ...currentPayload(existing), sendAt });
    const now = input.now ?? new Date();
    return transaction
      .update(sendQueue)
      .set({
        sendAt,
        payloadHash,
        approvalHash: payloadHash,
        approvedAt: now,
        approvalKind: "owner_click",
        status: "approved",
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(eq(sendQueue.workspaceId, tenant.workspaceId), eq(sendQueue.id, id)),
      )
      .returning()
      .get();
  });
}

export function addSuppressionEntry(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    email: string;
    reason: SuppressionReason;
    sourceKey?: string;
    now?: Date;
  },
): SuppressionEntry {
  return database.transaction((transaction) => {
    const id = randomUUID();
    const email = normalizeEmail(input.email);
    if (!email) throw new SendSafetyError("Suppression email must be valid.");
    const now = input.now ?? new Date();
    const sourceKey = input.sourceKey?.trim() || `manual:${id}`;
    const row = transaction
      .insert(suppressionEntry)
      .values({ id, workspaceId: tenant.workspaceId, email, reason: input.reason, sourceKey, at: now })
      .onConflictDoUpdate({
        target: [suppressionEntry.workspaceId, suppressionEntry.email, suppressionEntry.sourceKey],
        set: { reason: input.reason, at: now },
      })
      .returning()
      .get();
    transaction
      .update(sendQueue)
      .set({ status: "cancelled", approvalHash: null, approvalKind: null, approvedAt: null, updatedAt: now })
      .where(
        and(
          eq(sendQueue.workspaceId, tenant.workspaceId),
          eq(sendQueue.recipient, email),
          inArray(sendQueue.status, ["awaiting_approval", "approved", "failed", "held"]),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "SUPPRESSION_ADDED",
      entityType: "suppression_entry",
      entityId: row.id,
      payload: { reason: input.reason },
    });
    return row;
  });
}

export function syncContactSuppressionInTransaction(
  transaction: AppTransaction,
  tenant: TenantContext,
  contactId: string,
  networkingStatus: string,
  now: Date,
): void {
  const sourceKey = `contact:${contactId}`;
  transaction
    .delete(suppressionEntry)
    .where(
      and(
        eq(suppressionEntry.workspaceId, tenant.workspaceId),
        eq(suppressionEntry.sourceKey, sourceKey),
      ),
    )
    .run();
  if (networkingStatus !== "do_not_contact") return;
  const emails = transaction
    .select({ email: contactMethod.valueNormalized })
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.contactId, contactId),
        eq(contactMethod.kind, "email"),
      ),
    )
    .all();
  for (const { email } of emails) {
    transaction
      .insert(suppressionEntry)
      .values({
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        email,
        reason: "do_not_contact",
        sourceKey,
        at: now,
      })
      .onConflictDoUpdate({
        target: [
          suppressionEntry.workspaceId,
          suppressionEntry.email,
          suppressionEntry.sourceKey,
        ],
        set: { reason: "do_not_contact", at: now },
      })
      .run();
  }
  transaction
    .update(sendQueue)
    .set({
      status: "cancelled",
      approvalHash: null,
      approvedAt: null,
      approvalKind: null,
      lastError: "Contact is marked Do Not Contact.",
      updatedAt: now,
    })
    .where(
      and(
        eq(sendQueue.workspaceId, tenant.workspaceId),
        eq(sendQueue.contactId, contactId),
        inArray(sendQueue.status, [
          "awaiting_approval",
          "approved",
          "failed",
          "held",
        ]),
      ),
    )
    .run();
}

export function removeManualSuppression(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): boolean {
  const deleted = database
    .delete(suppressionEntry)
    .where(
      and(
        eq(suppressionEntry.workspaceId, tenant.workspaceId),
        eq(suppressionEntry.id, id),
        eq(suppressionEntry.reason, "manual"),
      ),
    )
    .returning({ id: suppressionEntry.id })
    .get();
  return deleted !== undefined;
}

export function removeSuppressionEntry(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): { removed: true } | { removed: false; status: 404 | 409; error: string } {
  const existing = database
    .select({ id: suppressionEntry.id, reason: suppressionEntry.reason })
    .from(suppressionEntry)
    .where(
      and(
        eq(suppressionEntry.workspaceId, tenant.workspaceId),
        eq(suppressionEntry.id, id),
      ),
    )
    .get();
  if (!existing) {
    return {
      removed: false,
      status: 404,
      error: "Removable suppression entry not found.",
    };
  }
  if (existing.reason !== "manual") {
    return {
      removed: false,
      status: 409,
      error:
        existing.reason === "bounced"
          ? "Bounced addresses cannot be un-suppressed."
          : "This suppression cannot be removed.",
    };
  }
  return removeManualSuppression(database, tenant, id)
    ? { removed: true }
    : {
        removed: false,
        status: 404,
        error: "Removable suppression entry not found.",
      };
}
