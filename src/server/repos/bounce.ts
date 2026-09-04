import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  FIND_ANOTHER_CONTACT_TITLE,
  SOFT_BOUNCE_SUPPRESS_AFTER,
  bounceSourceKey,
  bounceTaskKey,
  parseBounceSignal,
} from "../../domain/bounce";
import { calendarDateInZone } from "../../domain/referral";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { getWorkspaceSettings } from "../db/foundation";
import {
  bounceEvent,
  contact,
  contactMethod,
  emailAccount,
  sendQueue,
  sequenceEnrollment,
  suppressionEntry,
  task,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { DEFAULT_TIME_ZONE } from "../db/timezone";
import type { GmailThreadSnapshot } from "../mail/gmail-read-port";
import {
  cancelEnrollmentInTransaction,
  type SequenceEnrollment,
} from "./sequences";

export type BounceEvent = typeof bounceEvent.$inferSelect;

function ownedAccount(
  transaction: AppTransaction,
  tenant: TenantContext,
  accountId: string,
) {
  return transaction
    .select({ id: emailAccount.id })
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
}

function softBounceCount(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
): number {
  return transaction
    .select({ id: bounceEvent.id })
    .from(bounceEvent)
    .where(
      and(
        eq(bounceEvent.workspaceId, tenant.workspaceId),
        eq(bounceEvent.email, email),
        eq(bounceEvent.kind, "soft"),
      ),
    )
    .all().length;
}

function contactsForEmail(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
) {
  return transaction
    .select({
      contactId: contact.id,
      companyId: contact.companyId,
    })
    .from(contactMethod)
    .innerJoin(
      contact,
      and(
        eq(contact.workspaceId, contactMethod.workspaceId),
        eq(contact.id, contactMethod.contactId),
      ),
    )
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.kind, "email"),
        eq(contactMethod.valueNormalized, email),
      ),
    )
    .all();
}

function cancelQueuesForEmail(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
  now: Date,
) {
  transaction
    .update(sendQueue)
    .set({
      status: "cancelled",
      approvalHash: null,
      approvalKind: null,
      approvedAt: null,
      lastError: "Email is blocked by bounced suppression.",
      updatedAt: now,
    })
    .where(
      and(
        eq(sendQueue.workspaceId, tenant.workspaceId),
        eq(sendQueue.recipient, email),
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

function ensureFindAnotherContactTask(
  transaction: AppTransaction,
  tenant: TenantContext,
  linked: { contactId: string; companyId: string | null },
  email: string,
  now: Date,
) {
  const derivedFromKey = bounceTaskKey(linked.contactId);
  const existing = transaction
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, tenant.workspaceId),
        eq(task.derivedFromKey, derivedFromKey),
        eq(task.status, "open"),
      ),
    )
    .get();
  if (existing) return;
  const settings = getWorkspaceSettings(transaction, tenant, tenant.workspaceId);
  const dueOn = calendarDateInZone(settings?.timezone ?? DEFAULT_TIME_ZONE, now);
  const entityType = linked.companyId ? "company" : "contact";
  const entityId = linked.companyId ?? linked.contactId;
  const created = transaction
    .insert(task)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      title: FIND_ANOTHER_CONTACT_TITLE,
      description: `${email} bounced. Find another contact.`,
      dueOn,
      priority: "high",
      status: "open",
      source: "rule",
      entityType,
      entityId,
      derivedFromKey,
      createdByRule: true,
      completedAt: null,
      createdAt: now,
    })
    .returning()
    .get();
  logEvent(transaction, tenant, {
    at: now,
    kind: "TASK_CREATED",
    entityType: "task",
    entityId: created.id,
    payload: { title: FIND_ANOTHER_CONTACT_TITLE, email },
  });
}

function suppressBouncedAddress(
  transaction: AppTransaction,
  tenant: TenantContext,
  email: string,
  now: Date,
) {
  const sourceKey = bounceSourceKey(email);
  const row = transaction
    .insert(suppressionEntry)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      email,
      reason: "bounced",
      sourceKey,
      at: now,
    })
    .onConflictDoUpdate({
      target: [
        suppressionEntry.workspaceId,
        suppressionEntry.email,
        suppressionEntry.sourceKey,
      ],
      set: { reason: "bounced", at: now },
    })
    .returning()
    .get();
  cancelQueuesForEmail(transaction, tenant, email, now);
  transaction
    .update(contactMethod)
    .set({ invalidAt: now })
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.kind, "email"),
        eq(contactMethod.valueNormalized, email),
      ),
    )
    .run();
  const linkedContacts = contactsForEmail(transaction, tenant, email);
  const contactIds = linkedContacts.map((item) => item.contactId);
  if (contactIds.length > 0) {
    const enrollments = transaction
      .select()
      .from(sequenceEnrollment)
      .where(
        and(
          eq(sequenceEnrollment.workspaceId, tenant.workspaceId),
          inArray(sequenceEnrollment.contactId, contactIds),
          eq(sequenceEnrollment.status, "active"),
        ),
      )
      .all();
    for (const enrollment of enrollments as SequenceEnrollment[]) {
      cancelEnrollmentInTransaction(transaction, tenant, enrollment, "bounce", now);
    }
  }
  for (const linked of linkedContacts) {
    ensureFindAnotherContactTask(transaction, tenant, linked, email, now);
  }
  logEvent(transaction, tenant, {
    at: now,
    kind: "SUPPRESSION_ADDED",
    entityType: "suppression_entry",
    entityId: row.id,
    payload: { reason: "bounced", email },
  });
}

export function applyBouncesFromSnapshot(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  snapshot: GmailThreadSnapshot,
  now = new Date(),
): BounceEvent[] {
  return database.transaction((transaction) => {
    if (!ownedAccount(transaction, tenant, accountId)) return [];
    const recorded: BounceEvent[] = [];
    for (const message of snapshot.messages) {
      const signal = parseBounceSignal({
        fromEmail: message.fromEmail,
        subject: message.subject,
        body: message.body,
        deliveryStatusText: message.deliveryStatusText,
        failedRecipients: message.failedRecipients,
      });
      if (!signal) continue;
      const inserted = transaction
        .insert(bounceEvent)
        .values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          accountId,
          email: signal.recipient,
          gmailMessageId: message.gmailId,
          kind: signal.kind,
          smtpStatus: signal.smtpStatus,
          diagnostic: signal.diagnostic,
          at: now,
        })
        .onConflictDoNothing({
          target: [
            bounceEvent.workspaceId,
            bounceEvent.accountId,
            bounceEvent.gmailMessageId,
          ],
        })
        .returning()
        .get();
      if (!inserted) continue;
      recorded.push(inserted);
      logEvent(transaction, tenant, {
        at: now,
        kind: "BOUNCE_RECORDED",
        entityType: "bounce_event",
        entityId: inserted.id,
        payload: {
          accountId,
          email: inserted.email,
          kind: inserted.kind,
          gmailMessageId: inserted.gmailMessageId,
        },
      });
      const suppress =
        inserted.kind === "hard" ||
        softBounceCount(transaction, tenant, inserted.email) >=
          SOFT_BOUNCE_SUPPRESS_AFTER;
      if (suppress) {
        suppressBouncedAddress(transaction, tenant, inserted.email, now);
      }
    }
    return recorded;
  });
}
