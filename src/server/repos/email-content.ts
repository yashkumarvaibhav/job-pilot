import { randomUUID } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";

import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  company,
  contact,
  documentVersion,
  emailAccount,
  emailMessage,
  emailTemplate,
  emailThread,
  opportunity,
  referralRequest,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type EmailTemplate = typeof emailTemplate.$inferSelect;
export type EmailThread = typeof emailThread.$inferSelect;
export type EmailMessage = typeof emailMessage.$inferSelect;
export type EmailThreadWithMessages = EmailThread & { messages: EmailMessage[] };

export type CreateEmailTemplateInput = {
  id?: string;
  title: string;
  subject?: string;
  body?: string;
  variables?: string[];
  defaultEmailAccountId?: string | null;
  defaultDocumentVersionId?: string | null;
  defaultFollowUpDays?: number | null;
  tags?: string[];
  now?: Date;
};

export type EmailThreadSource = "sent" | "sync" | "manual_import";

export type UpsertEmailThreadInput = {
  id?: string;
  accountId: string;
  gmailThreadId: string;
  subject?: string;
  contactId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
  referralId?: string | null;
  source?: EmailThreadSource;
  lastMessageAt: Date;
  now?: Date;
};

export type RecordEmailMessageInput = {
  id?: string;
  threadId: string;
  accountId: string;
  gmailId: string;
  rfcMessageId?: string | null;
  direction: "inbound" | "outbound";
  fromEmail: string;
  to: string[];
  subject?: string;
  body?: string;
  attachmentVersionIds?: string[];
  sentAt: Date;
  now?: Date;
};

export class EmailContentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailContentInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0) {
    throw new EmailContentInputError(`${label} is required.`);
  }
  return normalized;
}

function optionalId(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function uniqueText(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function validInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw new EmailContentInputError(`${label} must be a valid instant.`);
  }
  return value;
}

function validEmail(value: string, label: string): string {
  const normalized = normalizeEmail(value);
  if (normalized === null) {
    throw new EmailContentInputError(`${label} must be a valid email address.`);
  }
  return normalized;
}

function requireOwnedAccount(
  transaction: AppTransaction,
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
  if (!row) {
    throw new EmailContentInputError("Gmail account not found.");
  }
  return row;
}

function requireOwnedOptionalEntity(
  transaction: AppTransaction,
  tenant: TenantContext,
  label: string,
  id: string | null,
  table: typeof contact | typeof company | typeof opportunity | typeof referralRequest,
): void {
  if (id === null) return;
  const found = transaction
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.workspaceId, tenant.workspaceId), eq(table.id, id)))
    .get();
  if (!found) {
    throw new EmailContentInputError(`${label} not found.`);
  }
}

function requireOwnedDocumentVersion(
  transaction: AppTransaction,
  tenant: TenantContext,
  versionId: string | null,
): void {
  if (versionId === null) return;
  const found = transaction
    .select({ id: documentVersion.id })
    .from(documentVersion)
    .where(
      and(
        eq(documentVersion.workspaceId, tenant.workspaceId),
        eq(documentVersion.id, versionId),
      ),
    )
    .get();
  if (!found) {
    throw new EmailContentInputError("Document version not found.");
  }
}

export function createEmailTemplate(
  database: AppDatabase,
  tenant: TenantContext,
  input: CreateEmailTemplateInput,
): EmailTemplate {
  const title = requiredText(input.title, "Template title");
  const defaultEmailAccountId = optionalId(input.defaultEmailAccountId);
  const defaultDocumentVersionId = optionalId(input.defaultDocumentVersionId);
  const defaultFollowUpDays = input.defaultFollowUpDays ?? null;
  if (
    defaultFollowUpDays !== null &&
    (!Number.isInteger(defaultFollowUpDays) ||
      defaultFollowUpDays < 0 ||
      defaultFollowUpDays > 365)
  ) {
    throw new EmailContentInputError(
      "Default follow-up delay must be a whole number from 0 to 365.",
    );
  }
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const duplicate = transaction
      .select({ id: emailTemplate.id })
      .from(emailTemplate)
      .where(
        and(
          eq(emailTemplate.workspaceId, tenant.workspaceId),
          eq(emailTemplate.title, title),
        ),
      )
      .get();
    if (duplicate) {
      throw new EmailContentInputError(
        `${title} already exists in this workspace.`,
      );
    }
    if (defaultEmailAccountId !== null) {
      const account = requireOwnedAccount(
        transaction,
        tenant,
        defaultEmailAccountId,
      );
      if (account.status !== "connected") {
        throw new EmailContentInputError("Choose a connected Gmail account.");
      }
    }
    requireOwnedDocumentVersion(
      transaction,
      tenant,
      defaultDocumentVersionId,
    );

    const row = transaction
      .insert(emailTemplate)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: tenant.workspaceId,
        title,
        subject: (input.subject ?? "").trim(),
        body: (input.body ?? "").trim(),
        variablesJson: uniqueText(input.variables),
        defaultEmailAccountId,
        defaultDocumentVersionId,
        defaultFollowUpDays,
        tagsJson: uniqueText(input.tags),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_TEMPLATE_CREATED",
      entityType: "email_template",
      entityId: row.id,
      payload: { title: row.title },
    });
    return row;
  });
}

export function listEmailTemplates(
  database: AppDatabase,
  tenant: TenantContext,
): EmailTemplate[] {
  return database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.workspaceId, tenant.workspaceId))
    .orderBy(asc(emailTemplate.title), asc(emailTemplate.id))
    .all();
}

export function upsertEmailThread(
  database: AppDatabase,
  tenant: TenantContext,
  input: UpsertEmailThreadInput,
): EmailThread {
  const accountId = requiredText(input.accountId, "Gmail account");
  const gmailThreadId = requiredText(input.gmailThreadId, "Gmail thread id");
  const contactId = optionalId(input.contactId);
  const companyId = optionalId(input.companyId);
  const opportunityId = optionalId(input.opportunityId);
  const referralId = optionalId(input.referralId);
  const lastMessageAt = validInstant(input.lastMessageAt, "Last message at");
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    requireOwnedAccount(transaction, tenant, accountId);
    requireOwnedOptionalEntity(transaction, tenant, "Contact", contactId, contact);
    requireOwnedOptionalEntity(transaction, tenant, "Company", companyId, company);
    requireOwnedOptionalEntity(
      transaction,
      tenant,
      "Opportunity",
      opportunityId,
      opportunity,
    );
    requireOwnedOptionalEntity(
      transaction,
      tenant,
      "Referral",
      referralId,
      referralRequest,
    );

    const existing = transaction
      .select()
      .from(emailThread)
      .where(
        and(
          eq(emailThread.workspaceId, tenant.workspaceId),
          eq(emailThread.accountId, accountId),
          eq(emailThread.gmailThreadId, gmailThreadId),
        ),
      )
      .get();
    if (existing) {
      return transaction
        .update(emailThread)
        .set({
          subject: (input.subject ?? "").trim(),
          contactId,
          companyId,
          opportunityId,
          referralId,
          source: input.source ?? existing.source,
          lastMessageAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(emailThread.workspaceId, tenant.workspaceId),
            eq(emailThread.id, existing.id),
          ),
        )
        .returning()
        .get();
    }

    const row = transaction
      .insert(emailThread)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: tenant.workspaceId,
        accountId,
        gmailThreadId,
        subject: (input.subject ?? "").trim(),
        contactId,
        companyId,
        opportunityId,
        referralId,
        source: input.source ?? "sync",
        lastMessageAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind:
        row.source === "manual_import"
          ? "EMAIL_THREAD_IMPORTED"
          : "EMAIL_THREAD_RECORDED",
      entityType: "email_thread",
      entityId: row.id,
      payload: { accountId: row.accountId, source: row.source },
    });
    return row;
  });
}

export function recordEmailMessage(
  database: AppDatabase,
  tenant: TenantContext,
  input: RecordEmailMessageInput,
): EmailMessage {
  const threadId = requiredText(input.threadId, "Email thread");
  const accountId = requiredText(input.accountId, "Gmail account");
  const gmailId = requiredText(input.gmailId, "Gmail message id");
  const sentAt = validInstant(input.sentAt, "Sent at");
  const now = input.now ?? new Date();
  const to = uniqueText(input.to).map((address) =>
    validEmail(address, "Recipient"),
  );
  if (to.length === 0) {
    throw new EmailContentInputError("At least one recipient is required.");
  }
  const attachmentVersionIds = uniqueText(input.attachmentVersionIds);

  return database.transaction((transaction) => {
    const ownedThread = transaction
      .select({ id: emailThread.id })
      .from(emailThread)
      .where(
        and(
          eq(emailThread.workspaceId, tenant.workspaceId),
          eq(emailThread.id, threadId),
          eq(emailThread.accountId, accountId),
        ),
      )
      .get();
    if (!ownedThread) {
      throw new EmailContentInputError("Email thread not found.");
    }
    requireOwnedAccount(transaction, tenant, accountId);
    for (const versionId of attachmentVersionIds) {
      requireOwnedDocumentVersion(transaction, tenant, versionId);
    }
    const existing = transaction
      .select()
      .from(emailMessage)
      .where(
        and(
          eq(emailMessage.workspaceId, tenant.workspaceId),
          eq(emailMessage.accountId, accountId),
          eq(emailMessage.gmailId, gmailId),
        ),
      )
      .get();
    if (existing) return existing;

    const row = transaction
      .insert(emailMessage)
      .values({
        id: input.id ?? randomUUID(),
        workspaceId: tenant.workspaceId,
        threadId,
        accountId,
        gmailId,
        rfcMessageId: optionalId(input.rfcMessageId),
        direction: input.direction,
        fromEmail: validEmail(input.fromEmail, "Sender"),
        toJson: to,
        subject: (input.subject ?? "").trim(),
        body: input.body ?? "",
        attachmentVersionIdsJson: attachmentVersionIds,
        sentAt,
        createdAt: now,
      })
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_MESSAGE_RECORDED",
      entityType: "email_message",
      entityId: row.id,
      payload: {
        accountId: row.accountId,
        direction: row.direction,
        threadId: row.threadId,
      },
    });
    return row;
  });
}

export function getEmailThread(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): EmailThreadWithMessages | undefined {
  const thread = database
    .select()
    .from(emailThread)
    .where(
      and(
        eq(emailThread.workspaceId, tenant.workspaceId),
        eq(emailThread.id, id),
      ),
    )
    .get();
  if (!thread) return undefined;
  const messages = database
    .select()
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.workspaceId, tenant.workspaceId),
        eq(emailMessage.threadId, thread.id),
      ),
    )
    .orderBy(asc(emailMessage.sentAt), asc(emailMessage.id))
    .all();
  return { ...thread, messages };
}

export function listEmailThreads(
  database: AppDatabase,
  tenant: TenantContext,
  accountId?: string,
): EmailThread[] {
  const conditions = [eq(emailThread.workspaceId, tenant.workspaceId)];
  if (accountId !== undefined) {
    conditions.push(eq(emailThread.accountId, accountId));
  }
  return database
    .select()
    .from(emailThread)
    .where(and(...conditions))
    .orderBy(desc(emailThread.lastMessageAt), desc(emailThread.id))
    .all();
}
