import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import {
  contact as contactTable,
  emailAccount,
  emailMessage,
  emailThread,
  interaction,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { getContact } from "../repos/contacts";
import { readDocumentVersionFile } from "../repos/documents";
import { getOpportunity } from "../repos/opportunities";
import { getReferral } from "../repos/referrals";
import { decryptRefreshToken } from "./token-crypto";
import type { MailAttachment, MailPort } from "./mail-port";

export type SendComposedEmailInput = {
  accountId: string;
  contactId: string;
  opportunityId?: string | null;
  referralId?: string | null;
  subject: string;
  body: string;
  attachmentVersionIds: string[];
  approval: "send_now";
};

export type ComposeSendDependencies = {
  mailPort: MailPort;
  tokenKey: string;
  uploadsRoot?: string;
};

export type SentEmailRecord = {
  accountId: string;
  contactId: string;
  threadId: string;
  messageId: string;
  interactionId: string;
};

export class ComposeSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeSendError";
  }
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0) {
    throw new ComposeSendError(`${label} is required.`);
  }
  if (normalized.length > maximum) {
    throw new ComposeSendError(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function primaryContactEmail(
  methods: NonNullable<ReturnType<typeof getContact>>["methods"],
): string | null {
  const emailMethods = methods.filter((method) => method.kind === "email");
  const selected = emailMethods.find((method) => method.isPrimary) ?? emailMethods[0];
  return selected ? normalizeEmail(selected.value) : null;
}

export async function sendComposedEmail(
  database: AppDatabase,
  tenant: TenantContext,
  input: SendComposedEmailInput,
  dependencies: ComposeSendDependencies,
): Promise<SentEmailRecord> {
  if (input.approval !== "send_now") {
    throw new ComposeSendError("Review the complete email before choosing Send now.");
  }
  const accountId = requiredText(input.accountId, "Gmail account", 200);
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
  if (!account) {
    const hasConnectedAccount = database
      .select({ id: emailAccount.id })
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.status, "connected"),
        ),
      )
      .get();
    throw new ComposeSendError(
      hasConnectedAccount
        ? "Gmail account not found."
        : "Connect Gmail in Settings before sending email.",
    );
  }
  if (account.status !== "connected") {
    throw new ComposeSendError(
      "The selected Gmail account is disconnected. Reconnect it in Settings.",
    );
  }

  const contact = getContact(database, tenant, input.contactId);
  if (!contact) {
    throw new ComposeSendError("Contact not found.");
  }
  if (contact.networkingStatus === "do_not_contact") {
    throw new ComposeSendError(
      "This contact is marked Do Not Contact. Email is blocked.",
    );
  }
  const recipient = primaryContactEmail(contact.methods);
  if (!recipient) {
    throw new ComposeSendError("This contact has no valid email address.");
  }

  const opportunityId = input.opportunityId?.trim() || null;
  const opportunity = opportunityId
    ? getOpportunity(database, tenant, opportunityId)
    : undefined;
  if (opportunityId && !opportunity) {
    throw new ComposeSendError("Opportunity not found.");
  }
  const referralId = input.referralId?.trim() || null;
  const referral = referralId ? getReferral(database, tenant, referralId) : undefined;
  if (referralId && !referral) {
    throw new ComposeSendError("Referral not found.");
  }
  if (referral && referral.contactId !== contact.id) {
    throw new ComposeSendError("Referral not found.");
  }
  if (
    referral?.opportunityId &&
    opportunityId &&
    referral.opportunityId !== opportunityId
  ) {
    throw new ComposeSendError("Referral not found.");
  }

  const subject = requiredText(input.subject, "Subject", 998);
  if (/\r|\n/.test(subject)) {
    throw new ComposeSendError("Subject must stay on one line.");
  }
  const body = requiredText(input.body, "Message", 500_000);
  const attachmentVersionIds = [...new Set(input.attachmentVersionIds)];
  const attachments: MailAttachment[] = attachmentVersionIds.map((versionId) => {
    const stored = readDocumentVersionFile(
      database,
      tenant,
      versionId,
      dependencies.uploadsRoot,
    );
    if (!stored) {
      throw new ComposeSendError("Document version not found.");
    }
    return {
      id: stored.version.id,
      filename: stored.version.originalFilename ?? `${stored.version.label}.pdf`,
      contentType: stored.version.contentType,
      bytes: stored.bytes,
    };
  });

  let refreshToken: string;
  try {
    refreshToken = decryptRefreshToken(
      account.tokenBlob,
      dependencies.tokenKey,
      `${tenant.workspaceId}:${account.id}`,
    );
  } catch {
    throw new ComposeSendError(
      "The selected Gmail credential is unavailable. Reconnect it in Settings.",
    );
  }

  const result = await dependencies.mailPort.send({
    accountId: account.id,
    refreshToken,
    fromEmail: account.email,
    senderName: account.senderName,
    replyTo: account.replyTo,
    to: [recipient],
    subject,
    body,
    attachments,
  });
  if (
    !result.gmailMessageId?.trim() ||
    !result.gmailThreadId?.trim() ||
    !result.rfcMessageId?.trim() ||
    !(result.sentAt instanceof Date) ||
    Number.isNaN(result.sentAt.valueOf())
  ) {
    throw new ComposeSendError(
      "Gmail accepted the request but returned an incomplete receipt. Check Sent before retrying.",
    );
  }

  return database.transaction((transaction) => {
    const now = result.sentAt;
    const existingThread = transaction
      .select()
      .from(emailThread)
      .where(
        and(
          eq(emailThread.workspaceId, tenant.workspaceId),
          eq(emailThread.accountId, account.id),
          eq(emailThread.gmailThreadId, result.gmailThreadId),
        ),
      )
      .get();
    const threadId = existingThread?.id ?? randomUUID();
    if (existingThread) {
      transaction
        .update(emailThread)
        .set({
          subject,
          contactId: contact.id,
          companyId: opportunity?.companyId ?? contact.companyId,
          opportunityId,
          referralId,
          source: "sent",
          lastMessageAt: result.sentAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(emailThread.workspaceId, tenant.workspaceId),
            eq(emailThread.id, threadId),
          ),
        )
        .run();
    } else {
      transaction
        .insert(emailThread)
        .values({
          id: threadId,
          workspaceId: tenant.workspaceId,
          accountId: account.id,
          gmailThreadId: result.gmailThreadId,
          subject,
          contactId: contact.id,
          companyId: opportunity?.companyId ?? contact.companyId,
          opportunityId,
          referralId,
          source: "sent",
          lastMessageAt: result.sentAt,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const messageId = randomUUID();
    transaction
      .insert(emailMessage)
      .values({
        id: messageId,
        workspaceId: tenant.workspaceId,
        threadId,
        accountId: account.id,
        gmailId: result.gmailMessageId,
        rfcMessageId: result.rfcMessageId,
        direction: "outbound",
        fromEmail: account.email,
        toJson: [recipient],
        subject,
        body,
        attachmentVersionIdsJson: attachmentVersionIds,
        sentAt: result.sentAt,
        createdAt: now,
      })
      .run();

    const interactionId = randomUUID();
    transaction
      .insert(interaction)
      .values({
        id: interactionId,
        workspaceId: tenant.workspaceId,
        contactId: contact.id,
        companyId: opportunity?.companyId ?? contact.companyId,
        opportunityId,
        referralId,
        channel: "email",
        direction: "outbound",
        occurredAt: result.sentAt,
        body,
        emailMessageId: messageId,
        requiresReply: false,
        replyResolvedAt: null,
        createdAt: now,
      })
      .run();
    transaction
      .update(interaction)
      .set({ replyResolvedAt: now })
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.contactId, contact.id),
          eq(interaction.requiresReply, true),
          isNull(interaction.replyResolvedAt),
        ),
      )
      .run();
    if (
      contact.lastInteractionAt === null ||
      result.sentAt.valueOf() >= contact.lastInteractionAt.valueOf()
    ) {
      transaction
        .update(contactTable)
        .set({ lastInteractionAt: result.sentAt })
        .where(
          and(
            eq(contactTable.workspaceId, tenant.workspaceId),
            eq(contactTable.id, contact.id),
          ),
        )
        .run();
    }
    logEvent(transaction, tenant, {
      at: result.sentAt,
      kind: "EMAIL_SENT",
      entityType: "interaction",
      entityId: interactionId,
      payload: {
        accountId: account.id,
        senderEmail: account.email,
        contactId: contact.id,
        companyId: opportunity?.companyId ?? contact.companyId,
        opportunityId,
        referralId,
        emailMessageId: messageId,
        threadId,
      },
    });
    return {
      accountId: account.id,
      contactId: contact.id,
      threadId,
      messageId,
      interactionId,
    };
  });
}
