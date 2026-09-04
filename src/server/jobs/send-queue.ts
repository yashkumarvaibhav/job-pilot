import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";

import {
  UNCERTAIN_DELIVERY_ERROR,
  hashSendPayload,
} from "../../domain/send-safety";
import { MAX_SYNC_AGE_MS, sequenceMailboxFreshness } from "../../domain/sequence";
import { isQuietHourInZone } from "../../domain/settings";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  contact,
  emailAccount,
  emailMessage,
  emailThread,
  interaction,
  sendQueue,
  sequenceEnrollment,
  settings,
  workspace,
} from "../db/schema";
import { createTenantContext, type TenantContext } from "../db/tenant";
import type { MailPort, MailSendResult } from "../mail/mail-port";
import { decryptRefreshToken } from "../mail/token-crypto";
import { readDocumentVersionFile } from "../repos/documents";
import { suppressionForRecipientInTransaction } from "../repos/send-safety";
import {
  HELD_MAILBOX_UNPROVEN,
  advanceEnrollmentAfterSend,
  cancelEnrollmentInTransaction,
  enrollmentFreshness,
  evaluateEnrollmentCancelInTransaction,
} from "../repos/sequences";

const DEFAULT_RECLAIM_AFTER_MS = 5 * 60_000;
const DEFAULT_MAX_SENDS = 25;

export type SendQueueDependencies = {
  mailPort: MailPort;
  tokenKey: string;
  uploadsRoot?: string;
};

type ClaimedQueueMessage = {
  row: typeof sendQueue.$inferSelect;
  account: typeof emailAccount.$inferSelect;
  tenant: TenantContext;
};

type ZonedClock = {
  date: string;
  weekday: string;
  minute: number;
};

function zonedClock(timeZone: string, instant: Date): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    minute: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function insideSendingWindow(
  now: Date,
  timeZone: string,
  start: number,
  end: number,
): boolean {
  const clock = zonedClock(timeZone, now);
  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(clock.weekday)) {
    return false;
  }
  if (start === end) return false;
  return start < end
    ? clock.minute >= start && clock.minute < end
    : clock.minute >= start || clock.minute < end;
}

function currentHash(row: typeof sendQueue.$inferSelect): string {
  return hashSendPayload({
    recipient: row.recipient,
    accountId: row.accountId,
    subject: row.subject,
    body: row.body,
    attachmentVersionIds: row.attachmentVersionIdsJson,
    sendAt: row.sendAt,
  });
}

function ownedTenantForWorkspace(
  transaction: AppTransaction,
  workspaceId: string,
): TenantContext | null {
  const owner = transaction
    .select({ userId: workspace.ownerUserId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .get();
  return owner ? createTenantContext(owner.userId, workspaceId) : null;
}

function countToday(
  transaction: AppTransaction,
  workspaceId: string,
  accountId: string,
  timeZone: string,
  now: Date,
): number {
  const date = zonedClock(timeZone, now).date;
  const sent = transaction
    .select({ sentAt: emailMessage.sentAt })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.workspaceId, workspaceId),
        eq(emailMessage.accountId, accountId),
        eq(emailMessage.direction, "outbound"),
      ),
    )
    .all()
    .filter((row) => zonedClock(timeZone, row.sentAt).date === date).length;
  const reserved = transaction
    .select({ claimedAt: sendQueue.claimedAt })
    .from(sendQueue)
    .where(
      and(
        eq(sendQueue.workspaceId, workspaceId),
        eq(sendQueue.accountId, accountId),
        eq(sendQueue.status, "claimed"),
      ),
    )
    .all()
    .filter(
      (row) =>
        row.claimedAt !== null && zonedClock(timeZone, row.claimedAt).date === date,
    ).length;
  return sent + reserved;
}

export function claimNextQueueMessage(
  database: AppDatabase,
  now = new Date(),
  onlyQueueId?: string,
): ClaimedQueueMessage | null {
  return database.transaction((transaction) => {
    const claimable = or(
      eq(sendQueue.status, "approved"),
      and(
        eq(sendQueue.status, "held"),
        eq(sendQueue.origin, "sequence"),
        sql`${sendQueue.approvalHash} is not null`,
        eq(sendQueue.lastError, HELD_MAILBOX_UNPROVEN),
      ),
    );
    const conditions = [claimable, lte(sendQueue.sendAt, now)];
    if (onlyQueueId) conditions.push(eq(sendQueue.id, onlyQueueId));
    const candidates = transaction
      .select()
      .from(sendQueue)
      .where(and(...conditions))
      .orderBy(asc(sendQueue.sendAt), asc(sendQueue.id))
      .limit(100)
      .all();

    for (const row of candidates) {
      const tenant = ownedTenantForWorkspace(transaction, row.workspaceId);
      if (!tenant) continue;
      const computed = currentHash(row);
      if (
        row.approvalHash === null ||
        row.approvedAt === null ||
        row.approvalKind === null ||
        row.payloadHash !== computed ||
        row.approvalHash !== computed
      ) {
        transaction
          .update(sendQueue)
          .set({
            status: "awaiting_approval",
            approvalHash: null,
            approvedAt: null,
            approvalKind: null,
            lastError: "Message changed after approval.",
            updatedAt: now,
          })
          .where(
            and(
              eq(sendQueue.workspaceId, row.workspaceId),
              eq(sendQueue.id, row.id),
              inArray(sendQueue.status, ["approved", "held"]),
            ),
          )
          .run();
        continue;
      }
      const blocked = suppressionForRecipientInTransaction(
        transaction,
        tenant,
        row.recipient,
        row.contactId,
      );
      if (row.origin === "sequence") {
        if (row.enrollmentId) {
          const enrollment = transaction
            .select()
            .from(sequenceEnrollment)
            .where(
              and(
                eq(sequenceEnrollment.workspaceId, row.workspaceId),
                eq(sequenceEnrollment.id, row.enrollmentId),
              ),
            )
            .get();
          if (!enrollment || enrollment.status !== "active") {
            transaction
              .update(sendQueue)
              .set({
                status: "cancelled",
                approvalHash: null,
                approvedAt: null,
                approvalKind: null,
                lastError: "Sequence enrollment is no longer active.",
                updatedAt: now,
              })
              .where(
                and(eq(sendQueue.workspaceId, row.workspaceId), eq(sendQueue.id, row.id)),
              )
              .run();
            continue;
          }
          const cancel = evaluateEnrollmentCancelInTransaction(
            transaction,
            tenant,
            enrollment,
            now,
          );
          if (cancel) {
            cancelEnrollmentInTransaction(transaction, tenant, enrollment, cancel, now);
            continue;
          }
          const freshness = enrollmentFreshness(transaction, tenant, enrollment, now);
          if (!freshness.ok) {
            transaction
              .update(sendQueue)
              .set({
                status: "held",
                lastError: freshness.hold,
                updatedAt: now,
              })
              .where(
                and(eq(sendQueue.workspaceId, row.workspaceId), eq(sendQueue.id, row.id)),
              )
              .run();
            continue;
          }
        } else {
          const sequenceAccount = transaction
            .select()
            .from(emailAccount)
            .where(
              and(
                eq(emailAccount.workspaceId, row.workspaceId),
                eq(emailAccount.id, row.accountId),
              ),
            )
            .get();
          const freshness = sequenceMailboxFreshness({
            accountStatus: sequenceAccount?.status ?? "disconnected",
            sequenceSafeAt: sequenceAccount?.sequenceSafeAt ?? null,
            enrolledAt: sequenceAccount?.sequenceSafeAt ?? new Date(0),
            threadId: null,
            threadProvenAt: null,
            recoveryOpen: false,
            now,
            maxSyncAgeMs: MAX_SYNC_AGE_MS,
          });
          if (!freshness.ok) {
            transaction
              .update(sendQueue)
              .set({
                status: "held",
                lastError: HELD_MAILBOX_UNPROVEN,
                updatedAt: now,
              })
              .where(
                and(eq(sendQueue.workspaceId, row.workspaceId), eq(sendQueue.id, row.id)),
              )
              .run();
            continue;
          }
        }
      }
      if (blocked) {
        transaction
          .update(sendQueue)
          .set({
            status: "cancelled",
            approvalHash: null,
            approvedAt: null,
            approvalKind: null,
            lastError: blocked.message,
            updatedAt: now,
          })
          .where(
            and(eq(sendQueue.workspaceId, row.workspaceId), eq(sendQueue.id, row.id)),
          )
          .run();
        continue;
      }
      const account = transaction
        .select()
        .from(emailAccount)
        .where(
          and(
            eq(emailAccount.workspaceId, row.workspaceId),
            eq(emailAccount.id, row.accountId),
            eq(emailAccount.status, "connected"),
          ),
        )
        .get();
      const workspaceSettings = transaction
        .select({
          timeZone: settings.timezone,
          quietStart: settings.quietStart,
          quietEnd: settings.quietEnd,
        })
        .from(settings)
        .where(eq(settings.workspaceId, row.workspaceId))
        .get();
      if (!account || !workspaceSettings) {
        transaction
          .update(sendQueue)
          .set({ status: "held", lastError: "Sending account is unavailable.", updatedAt: now })
          .where(
            and(eq(sendQueue.workspaceId, row.workspaceId), eq(sendQueue.id, row.id)),
          )
          .run();
        continue;
      }
      const outsideWindow =
        row.origin === "self_digest"
          ? isQuietHourInZone(
              workspaceSettings.timeZone,
              now,
              workspaceSettings.quietStart,
              workspaceSettings.quietEnd,
            )
          : !insideSendingWindow(
              now,
              workspaceSettings.timeZone,
              account.sendingWindowStart,
              account.sendingWindowEnd,
            );
      if (
        outsideWindow ||
        countToday(
          transaction,
          row.workspaceId,
          row.accountId,
          workspaceSettings.timeZone,
          now,
        ) >= account.dailyLimit
      ) {
        continue;
      }
      const claimed = transaction
        .update(sendQueue)
        .set({
          status: "claimed",
          claimedAt: now,
          attempts: sql`${sendQueue.attempts} + 1`,
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(sendQueue.workspaceId, row.workspaceId),
            eq(sendQueue.id, row.id),
            eq(sendQueue.status, row.status),
            eq(sendQueue.payloadHash, computed),
            eq(sendQueue.approvalHash, computed),
          ),
        )
        .returning()
        .get();
      if (claimed) return { row: claimed, account, tenant };
    }
    return null;
  });
}

function finalizeSent(
  database: AppDatabase,
  claim: ClaimedQueueMessage,
  receipt: {
    gmailMessageId: string;
    gmailThreadId: string;
    rfcMessageId: string | null;
    sentAt: Date;
  },
): void {
  database.transaction((transaction) => {
    const row = transaction
      .select()
      .from(sendQueue)
      .where(
        and(
          eq(sendQueue.workspaceId, claim.tenant.workspaceId),
          eq(sendQueue.id, claim.row.id),
          eq(sendQueue.status, "claimed"),
        ),
      )
      .get();
    if (!row) return;
    const contactRow = row.contactId
      ? transaction
          .select()
          .from(contact)
          .where(
            and(
              eq(contact.workspaceId, claim.tenant.workspaceId),
              eq(contact.id, row.contactId),
            ),
          )
          .get()
      : null;
    const existingThread = transaction
      .select()
      .from(emailThread)
      .where(
        and(
          eq(emailThread.workspaceId, claim.tenant.workspaceId),
          eq(emailThread.accountId, row.accountId),
          eq(emailThread.gmailThreadId, receipt.gmailThreadId),
        ),
      )
      .get();
    const threadId = existingThread?.id ?? randomUUID();
    if (existingThread) {
      transaction
        .update(emailThread)
        .set({
          subject: row.subject,
          contactId: row.contactId,
          companyId: contactRow?.companyId ?? null,
          opportunityId: row.opportunityId,
          referralId: row.referralId,
          source: "sent",
          matchStatus: "automatic",
          matchReason: "Exact queued outreach",
          suggestedContactIdsJson: [],
          lastMessageAt: receipt.sentAt,
          updatedAt: receipt.sentAt,
        })
        .where(
          and(
            eq(emailThread.workspaceId, claim.tenant.workspaceId),
            eq(emailThread.id, threadId),
          ),
        )
        .run();
    } else {
      transaction
        .insert(emailThread)
        .values({
          id: threadId,
          workspaceId: claim.tenant.workspaceId,
          accountId: row.accountId,
          gmailThreadId: receipt.gmailThreadId,
          subject: row.subject,
          contactId: row.contactId,
          companyId: contactRow?.companyId ?? null,
          opportunityId: row.opportunityId,
          referralId: row.referralId,
          source: "sent",
          matchStatus: "automatic",
          matchReason: "Exact queued outreach",
          suggestedContactIdsJson: [],
          lastMessageAt: receipt.sentAt,
          createdAt: receipt.sentAt,
          updatedAt: receipt.sentAt,
        })
        .run();
    }
    let message = transaction
      .select()
      .from(emailMessage)
      .where(
        and(
          eq(emailMessage.workspaceId, claim.tenant.workspaceId),
          eq(emailMessage.accountId, row.accountId),
          eq(emailMessage.gmailId, receipt.gmailMessageId),
        ),
      )
      .get();
    if (!message) {
      message = transaction
        .insert(emailMessage)
        .values({
          id: randomUUID(),
          workspaceId: claim.tenant.workspaceId,
          threadId,
          accountId: row.accountId,
          gmailId: receipt.gmailMessageId,
          rfcMessageId: receipt.rfcMessageId,
          direction: "outbound",
          fromEmail: claim.account.email,
          toJson: [row.recipient],
          subject: row.subject,
          body: row.body,
          attachmentVersionIdsJson: row.attachmentVersionIdsJson,
          sentAt: receipt.sentAt,
          createdAt: receipt.sentAt,
        })
        .returning()
        .get();
    }
    if (contactRow) {
      let interactionRow = transaction
        .select({ id: interaction.id })
        .from(interaction)
        .where(
          and(
            eq(interaction.workspaceId, claim.tenant.workspaceId),
            eq(interaction.emailMessageId, message.id),
          ),
        )
        .get();
      if (!interactionRow) {
        interactionRow = { id: randomUUID() };
        transaction
          .insert(interaction)
          .values({
            id: interactionRow.id,
            workspaceId: claim.tenant.workspaceId,
            contactId: contactRow.id,
            companyId: contactRow.companyId,
            opportunityId: row.opportunityId,
            referralId: row.referralId,
            channel: "email",
            direction: "outbound",
            occurredAt: receipt.sentAt,
            body: row.body,
            emailMessageId: message.id,
            requiresReply: false,
            replyResolvedAt: null,
            createdAt: receipt.sentAt,
          })
          .run();
        transaction
          .update(interaction)
          .set({ replyResolvedAt: receipt.sentAt })
          .where(
            and(
              eq(interaction.workspaceId, claim.tenant.workspaceId),
              eq(interaction.contactId, contactRow.id),
              eq(interaction.requiresReply, true),
              sql`${interaction.replyResolvedAt} is null`,
            ),
          )
          .run();
        if (
          contactRow.lastInteractionAt === null ||
          receipt.sentAt.valueOf() >= contactRow.lastInteractionAt.valueOf()
        ) {
          transaction
            .update(contact)
            .set({ lastInteractionAt: receipt.sentAt })
            .where(
              and(
                eq(contact.workspaceId, claim.tenant.workspaceId),
                eq(contact.id, contactRow.id),
              ),
            )
            .run();
        }
      }
    }
    transaction
      .update(sendQueue)
      .set({
        status: "sent",
        gmailMessageId: receipt.gmailMessageId,
        gmailThreadId: receipt.gmailThreadId,
        sentAt: receipt.sentAt,
        lastError: null,
        updatedAt: receipt.sentAt,
      })
      .where(
        and(
          eq(sendQueue.workspaceId, claim.tenant.workspaceId),
          eq(sendQueue.id, row.id),
          eq(sendQueue.status, "claimed"),
        ),
      )
      .run();
    logEvent(transaction, claim.tenant, {
      at: receipt.sentAt,
      kind: "EMAIL_SENT",
      entityType: "send_queue",
      entityId: row.id,
      payload: {
        accountId: row.accountId,
        contactId: row.contactId,
        emailMessageId: message.id,
        threadId,
      },
    });
    if (row.origin === "sequence" && row.enrollmentId) {
      advanceEnrollmentAfterSend(
        transaction,
        claim.tenant,
        row.enrollmentId,
        threadId,
        receipt.sentAt,
      );
    }
  });
}

function holdClaim(
  database: AppDatabase,
  row: typeof sendQueue.$inferSelect,
  now: Date,
  error: string,
  consumeApproval = false,
) {
  database
    .update(sendQueue)
    .set({
      status: "held",
      approvalHash: consumeApproval ? null : row.approvalHash,
      approvedAt: consumeApproval ? null : row.approvedAt,
      approvalKind: consumeApproval ? null : row.approvalKind,
      lastError: error,
      updatedAt: now,
    })
    .where(
      and(
        eq(sendQueue.workspaceId, row.workspaceId),
        eq(sendQueue.id, row.id),
        eq(sendQueue.status, "claimed"),
      ),
    )
    .run();
}

export async function reconcileClaimedRows(
  database: AppDatabase,
  options: { now?: Date; reclaimAfterMs?: number } = {},
): Promise<{ sent: number; approved: number; held: number }> {
  const now = options.now ?? new Date();
  const reclaimAfterMs = options.reclaimAfterMs ?? DEFAULT_RECLAIM_AFTER_MS;
  const staleBefore = new Date(now.valueOf() - reclaimAfterMs);
  const rows = database
    .select()
    .from(sendQueue)
    .where(and(eq(sendQueue.status, "claimed"), lte(sendQueue.claimedAt, staleBefore)))
    .orderBy(asc(sendQueue.claimedAt), asc(sendQueue.id))
    .all();
  const summary = { sent: 0, approved: 0, held: 0 };
  for (const row of rows) {
    holdClaim(database, row, now, UNCERTAIN_DELIVERY_ERROR, true);
    summary.held += 1;
  }
  return summary;
}

export async function flushSendQueue(
  database: AppDatabase,
  dependencies: SendQueueDependencies,
  options: {
    now?: Date;
    reclaimAfterMs?: number;
    maxSends?: number;
    onlyQueueId?: string;
    afterTransportAccepted?: (
      claim: ClaimedQueueMessage,
      receipt: MailSendResult,
    ) => void | Promise<void>;
  } = {},
): Promise<{ reconciled: number; sent: number; deferred: number }> {
  const now = options.now ?? new Date();
  const reconciled = await reconcileClaimedRows(database, {
    now,
    reclaimAfterMs: options.reclaimAfterMs,
  });
  let sent = 0;
  let deferred = 0;
  for (let index = 0; index < (options.maxSends ?? DEFAULT_MAX_SENDS); index += 1) {
    const claim = claimNextQueueMessage(database, now, options.onlyQueueId);
    if (!claim) break;
    let refreshToken: string;
    try {
      refreshToken = decryptRefreshToken(
        claim.account.tokenBlob,
        dependencies.tokenKey,
        `${claim.tenant.workspaceId}:${claim.account.id}`,
      );
    } catch {
      holdClaim(database, claim.row, now, "Sending credential is unavailable.");
      deferred += 1;
      continue;
    }
    const attachments = claim.row.attachmentVersionIdsJson.map((versionId) => {
      const stored = readDocumentVersionFile(
        database,
        claim.tenant,
        versionId,
        dependencies.uploadsRoot,
      );
      if (!stored) throw new Error("Queued attachment is unavailable.");
      return {
        id: stored.version.id,
        filename: stored.version.originalFilename ?? `${stored.version.label}.pdf`,
        contentType: stored.version.contentType,
        bytes: stored.bytes,
      };
    });
    let receipt: MailSendResult;
    try {
      receipt = await dependencies.mailPort.send({
        accountId: claim.account.id,
        refreshToken,
        fromEmail: claim.account.email,
        senderName: claim.account.senderName,
        replyTo: claim.account.replyTo,
        to: [claim.row.recipient],
        subject: claim.row.subject,
        body: claim.row.body,
        attachments,
        rfcMessageId: claim.row.messageId,
      });
    } catch {
      holdClaim(database, claim.row, now, UNCERTAIN_DELIVERY_ERROR, true);
      deferred += 1;
      continue;
    }
    await options.afterTransportAccepted?.(claim, receipt);
    if (
      !receipt.gmailMessageId.trim() ||
      !receipt.gmailThreadId.trim() ||
      !(receipt.sentAt instanceof Date) ||
      Number.isNaN(receipt.sentAt.valueOf())
    ) {
      holdClaim(database, claim.row, now, UNCERTAIN_DELIVERY_ERROR, true);
      deferred += 1;
      continue;
    }
    finalizeSent(database, claim, receipt);
    sent += 1;
  }
  return {
    reconciled: reconciled.sent + reconciled.approved + reconciled.held,
    sent,
    deferred,
  };
}
