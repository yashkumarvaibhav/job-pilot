import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  isReplyClassification,
  type ReplyClassification,
} from "../../domain/reply-classification";
import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import {
  company,
  contact,
  contactMethod,
  emailAccount,
  emailMessage,
  emailThread,
  interaction,
  referralRequest,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import type {
  GmailReadPort,
  GmailThreadSnapshot,
} from "../mail/gmail-read-port";
import { readEmailAccountRefreshToken } from "./email-accounts";
import {
  getEmailThread,
  listEmailThreads,
  recordEmailMessage,
  upsertEmailThread,
  type EmailThread,
  type EmailThreadSource,
  type EmailThreadWithMessages,
} from "./email-content";

export type InboxMatch = {
  status: "unmatched" | "automatic" | "suggested" | "manual";
  reason: string | null;
  suggestedContactIds: string[];
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  referralId: string | null;
};

export type InboxReadDependencies = {
  port: GmailReadPort;
  tokenKey: string;
  now?: () => Date;
};

export type GmailThreadPreview = GmailThreadSnapshot & {
  subject: string;
  counterpartEmail: string;
  lastMessageAt: Date;
};

export class InboxContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxContentError";
  }
}

function ownedAccount(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  action: "syncing" | "searching" | "importing" = "importing",
) {
  const row = database
    .select()
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  if (!row) throw new InboxContentError("Gmail account not found.");
  if (row.status !== "connected") {
    throw new InboxContentError(
      `Reconnect this Gmail account before ${action}.`,
    );
  }
  return row;
}

function refreshToken(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  tokenKey: string,
): string {
  try {
    const token = readEmailAccountRefreshToken(
      database,
      tenant,
      accountId,
      tokenKey,
    );
    if (token) return token;
  } catch {
    // The safe user-facing error below does not disclose token material.
  }
  throw new InboxContentError("Reconnect this Gmail account before importing.");
}

function participantEmails(
  accountEmail: string,
  snapshot: GmailThreadSnapshot,
): string[] {
  const owner = accountEmail.toLowerCase();
  const participants = snapshot.messages.flatMap((message) => [
    message.fromEmail,
    ...message.to,
  ]);
  return [...new Set(participants.map(normalizeEmail).filter(
    (email): email is string => email !== null && email !== owner,
  ))];
}

function websiteDomain(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function emailDomain(value: string): string | null {
  const domain = value.split("@")[1]?.toLowerCase().replace(/^www\./, "");
  return domain || null;
}

function linkForContact(
  database: AppDatabase,
  tenant: TenantContext,
  contactId: string,
) {
  const ownedContact = database
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        eq(contact.id, contactId),
      ),
    )
    .get();
  if (!ownedContact) throw new InboxContentError("Contact not found.");
  const referrals = database
    .select()
    .from(referralRequest)
    .where(
      and(
        eq(referralRequest.workspaceId, tenant.workspaceId),
        eq(referralRequest.contactId, contactId),
      ),
    )
    .all()
    .filter(
      (row) => !["declined", "expired", "cancelled"].includes(row.stage),
    );
  const referral = referrals.length === 1 ? referrals[0] : null;
  return {
    contactId,
    companyId: ownedContact.companyId,
    opportunityId: referral?.opportunityId ?? null,
    referralId: referral?.id ?? null,
  };
}

function automatic(
  reason: string,
  link: ReturnType<typeof linkForContact>,
): InboxMatch {
  return {
    status: "automatic",
    reason,
    suggestedContactIds: [],
    ...link,
  };
}

function suggested(reason: string, contactIds: string[]): InboxMatch {
  return {
    status: "suggested",
    reason,
    suggestedContactIds: [...new Set(contactIds)].sort(),
    contactId: null,
    companyId: null,
    opportunityId: null,
    referralId: null,
  };
}

const UNMATCHED: InboxMatch = {
  status: "unmatched",
  reason: null,
  suggestedContactIds: [],
  contactId: null,
  companyId: null,
  opportunityId: null,
  referralId: null,
};

export function matchInboxThread(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  snapshot: GmailThreadSnapshot,
): InboxMatch {
  const account = ownedAccount(database, tenant, accountId, "syncing");
  const existing = database
    .select()
    .from(emailThread)
    .where(
      and(
        eq(emailThread.workspaceId, tenant.workspaceId),
        eq(emailThread.accountId, accountId),
        eq(emailThread.gmailThreadId, snapshot.gmailThreadId),
      ),
    )
    .get();
  if (existing?.contactId) {
    return {
      status:
        existing.matchStatus === "manual" ? "manual" : "automatic",
      reason:
        existing.matchStatus === "manual"
          ? existing.matchReason ?? "Linked manually"
          : "Existing linked Gmail thread",
      suggestedContactIds: [],
        contactId: existing.contactId,
        companyId: existing.companyId,
        opportunityId: existing.opportunityId,
        referralId: existing.referralId,
    };
  }

  const rfcMessageIds = snapshot.messages
    .map((message) => message.rfcMessageId)
    .filter((id): id is string => id !== null);
  if (rfcMessageIds.length > 0) {
    const prior = database
      .select({ thread: emailThread })
      .from(emailMessage)
      .innerJoin(
        emailThread,
        and(
          eq(emailThread.workspaceId, emailMessage.workspaceId),
          eq(emailThread.id, emailMessage.threadId),
        ),
      )
      .where(
        and(
          eq(emailMessage.workspaceId, tenant.workspaceId),
          eq(emailMessage.accountId, accountId),
          eq(emailMessage.direction, "outbound"),
          inArray(emailMessage.rfcMessageId, rfcMessageIds),
        ),
      )
      .get()?.thread;
    if (prior?.contactId) {
      return automatic("Exact prior outbound message", {
        contactId: prior.contactId,
        companyId: prior.companyId,
        opportunityId: prior.opportunityId,
        referralId: prior.referralId,
      });
    }
  }

  const participants = participantEmails(account.email, snapshot);
  if (participants.length === 0) return UNMATCHED;
  const exact = database
    .select({ contactId: contactMethod.contactId })
    .from(contactMethod)
    .where(
      and(
        eq(contactMethod.workspaceId, tenant.workspaceId),
        eq(contactMethod.kind, "email"),
        inArray(contactMethod.valueNormalized, participants),
      ),
    )
    .all()
    .map((row) => row.contactId);
  const exactIds = [...new Set(exact)].sort();
  if (exactIds.length === 1) {
    return automatic(
      "Unique exact contact email",
      linkForContact(database, tenant, exactIds[0]),
    );
  }
  if (exactIds.length > 1) {
    return suggested("Multiple exact contact emails", exactIds);
  }

  const domains = new Set(
    participants.map(emailDomain).filter((value): value is string => value !== null),
  );
  const companyIds = database
    .select({ id: company.id, website: company.website })
    .from(company)
    .where(eq(company.workspaceId, tenant.workspaceId))
    .all()
    .filter((row) => {
      const domain = websiteDomain(row.website);
      return domain !== null && domains.has(domain);
    })
    .map((row) => row.id);
  if (companyIds.length === 0) return UNMATCHED;
  const domainContacts = database
    .select({ id: contact.id })
    .from(contact)
    .where(
      and(
        eq(contact.workspaceId, tenant.workspaceId),
        inArray(contact.companyId, companyIds),
      ),
    )
    .all()
    .map((row) => row.id);
  return suggested("Company domain only", domainContacts);
}

function ensureInboundInteraction(
  transaction: AppTransaction,
  tenant: TenantContext,
  thread: EmailThread,
  message: typeof emailMessage.$inferSelect,
  now: Date,
) {
  if (message.direction !== "inbound") return undefined;
  if (
    thread.contactId === null &&
    thread.companyId === null &&
    thread.opportunityId === null &&
    thread.referralId === null
  ) {
    return undefined;
  }
  const existing = transaction
    .select()
    .from(interaction)
    .where(
      and(
        eq(interaction.workspaceId, tenant.workspaceId),
        eq(interaction.emailMessageId, message.id),
      ),
    )
    .get();
  if (existing) {
    return transaction
      .update(interaction)
      .set({
        contactId: thread.contactId,
        companyId: thread.companyId,
        opportunityId: thread.opportunityId,
        referralId: thread.referralId,
      })
      .where(
        and(
          eq(interaction.workspaceId, tenant.workspaceId),
          eq(interaction.id, existing.id),
        ),
      )
      .returning()
      .get();
  }
  const row = transaction
    .insert(interaction)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      contactId: thread.contactId,
      companyId: thread.companyId,
      opportunityId: thread.opportunityId,
      referralId: thread.referralId,
      channel: "email",
      direction: "inbound",
      occurredAt: message.sentAt,
      body: message.body,
      emailMessageId: message.id,
      requiresReply: message.classification === "need_to_respond",
      replyResolvedAt: null,
      createdAt: now,
    })
    .returning()
    .get();
  if (thread.contactId !== null) {
    const ownedContact = transaction
      .select({ lastInteractionAt: contact.lastInteractionAt })
      .from(contact)
      .where(
        and(
          eq(contact.workspaceId, tenant.workspaceId),
          eq(contact.id, thread.contactId),
        ),
      )
      .get();
    if (
      ownedContact &&
      (ownedContact.lastInteractionAt === null ||
        message.sentAt.valueOf() >= ownedContact.lastInteractionAt.valueOf())
    ) {
      transaction
        .update(contact)
        .set({ lastInteractionAt: message.sentAt })
        .where(
          and(
            eq(contact.workspaceId, tenant.workspaceId),
            eq(contact.id, thread.contactId),
          ),
        )
        .run();
    }
  }
  if (thread.referralId !== null) {
    transaction
      .update(referralRequest)
      .set({ stage: "seen_acknowledged" })
      .where(
        and(
          eq(referralRequest.workspaceId, tenant.workspaceId),
          eq(referralRequest.id, thread.referralId),
          eq(referralRequest.stage, "requested"),
        ),
      )
      .run();
  }
  logEvent(transaction, tenant, {
    at: now,
    kind: "EMAIL_RECEIVED",
    entityType: "interaction",
    entityId: row.id,
    payload: {
      accountId: message.accountId,
      emailMessageId: message.id,
      threadId: thread.id,
      contactId: thread.contactId,
      opportunityId: thread.opportunityId,
      referralId: thread.referralId,
    },
  });
  return row;
}

function storeSnapshot(
  database: AppDatabase,
  tenant: TenantContext,
  account: typeof emailAccount.$inferSelect,
  snapshot: GmailThreadSnapshot,
  source: EmailThreadSource,
  match: InboxMatch,
  now: Date,
): EmailThread | undefined {
  if (snapshot.messages.length === 0) return undefined;
  const ordered = [...snapshot.messages].sort(
    (left, right) => left.sentAt.valueOf() - right.sentAt.valueOf(),
  );
  const latest = ordered.at(-1)!;
  const thread = upsertEmailThread(database, tenant, {
    accountId: account.id,
    gmailThreadId: snapshot.gmailThreadId,
    subject: latest.subject,
    contactId: match.contactId,
    companyId: match.companyId,
    opportunityId: match.opportunityId,
    referralId: match.referralId,
    source,
    matchStatus: match.status,
    matchReason: match.reason,
    suggestedContactIds: match.suggestedContactIds,
    lastMessageAt: latest.sentAt,
    now,
  });
  for (const message of ordered) {
    const stored = recordEmailMessage(database, tenant, {
      threadId: thread.id,
      accountId: account.id,
      gmailId: message.gmailId,
      rfcMessageId: message.rfcMessageId,
      direction:
        message.fromEmail.toLowerCase() === account.email.toLowerCase()
          ? "outbound"
          : "inbound",
      fromEmail: message.fromEmail,
      to: message.to,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt,
      now,
    });
    if (
      stored.direction === "inbound" &&
      (thread.contactId !== null ||
        thread.companyId !== null ||
        thread.opportunityId !== null ||
        thread.referralId !== null)
    ) {
      database.transaction((transaction) =>
        ensureInboundInteraction(transaction, tenant, thread, stored, now),
      );
    }
  }
  return thread;
}

export function ingestSyncedThreadSnapshot(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  snapshot: GmailThreadSnapshot,
  now = new Date(),
  source: "sync" | "manual_import" = "sync",
): EmailThread | undefined {
  const account = ownedAccount(database, tenant, accountId, "syncing");
  const match = matchInboxThread(database, tenant, accountId, snapshot);
  const existing = database
    .select({ id: emailThread.id })
    .from(emailThread)
    .where(
      and(
        eq(emailThread.workspaceId, tenant.workspaceId),
        eq(emailThread.accountId, accountId),
        eq(emailThread.gmailThreadId, snapshot.gmailThreadId),
      ),
    )
    .get();
  if (source === "sync" && match.status === "unmatched" && !existing) {
    return undefined;
  }
  return storeSnapshot(database, tenant, account, snapshot, source, match, now);
}

function preview(
  accountEmail: string,
  snapshot: GmailThreadSnapshot,
): GmailThreadPreview {
  const messages = [...snapshot.messages].sort(
    (left, right) => left.sentAt.valueOf() - right.sentAt.valueOf(),
  );
  const latest = messages.at(-1);
  if (!latest) throw new InboxContentError("Gmail returned an empty thread.");
  return {
    ...snapshot,
    messages,
    subject: latest.subject,
    counterpartEmail:
      participantEmails(accountEmail, snapshot)[0] ?? "Unknown sender",
    lastMessageAt: latest.sentAt,
  };
}

export async function searchGmailThreads(
  database: AppDatabase,
  tenant: TenantContext,
  input: { accountId: string; query: string },
  dependencies: InboxReadDependencies,
): Promise<GmailThreadPreview[]> {
  const query = input.query.trim();
  if (!query || query.length > 500) {
    throw new InboxContentError("Enter a Gmail search query.");
  }
  const account = ownedAccount(database, tenant, input.accountId, "searching");
  const token = refreshToken(
    database,
    tenant,
    account.id,
    dependencies.tokenKey,
  );
  const result = await dependencies.port.listThreads({
    refreshToken: token,
    query,
    maxResults: 10,
    pageToken: null,
  });
  const previews: GmailThreadPreview[] = [];
  for (const gmailThreadId of [...new Set(result.threadIds)].slice(0, 10)) {
    const thread = await dependencies.port.getThread({
      refreshToken: token,
      gmailThreadId,
    });
    previews.push(preview(account.email, thread));
  }
  return previews;
}

export async function importGmailThread(
  database: AppDatabase,
  tenant: TenantContext,
  input: {
    accountId: string;
    gmailThreadId: string;
    contactId?: string | null;
    opportunityId?: string | null;
    referralId?: string | null;
  },
  dependencies: InboxReadDependencies,
): Promise<EmailThread> {
  const gmailThreadId = input.gmailThreadId.trim();
  if (!gmailThreadId) throw new InboxContentError("Choose a Gmail thread.");
  const account = ownedAccount(database, tenant, input.accountId, "importing");
  const token = refreshToken(
    database,
    tenant,
    account.id,
    dependencies.tokenKey,
  );
  const snapshot = await dependencies.port.getThread({
    refreshToken: token,
    gmailThreadId,
  });
  if (snapshot.gmailThreadId !== gmailThreadId) {
    throw new InboxContentError("Gmail thread not found.");
  }
  const existing = database
    .select()
    .from(emailThread)
    .where(
      and(
        eq(emailThread.workspaceId, tenant.workspaceId),
        eq(emailThread.accountId, account.id),
        eq(emailThread.gmailThreadId, gmailThreadId),
      ),
    )
    .get();
  let match: InboxMatch;
  if (input.contactId) {
    match = {
      status: "manual",
      reason: "Linked during import",
      suggestedContactIds: [],
      ...linkForContact(database, tenant, input.contactId),
      opportunityId: input.opportunityId ?? null,
      referralId: input.referralId ?? null,
    };
  } else if (existing) {
    match = {
      status: existing.matchStatus,
      reason: existing.matchReason,
      suggestedContactIds: existing.suggestedContactIdsJson,
      contactId: existing.contactId,
      companyId: existing.companyId,
      opportunityId: existing.opportunityId,
      referralId: existing.referralId,
    };
  } else {
    match = UNMATCHED;
  }
  const stored = storeSnapshot(
    database,
    tenant,
    account,
    snapshot,
    "manual_import",
    match,
    dependencies.now?.() ?? new Date(),
  );
  if (!stored) throw new InboxContentError("Gmail returned an empty thread.");
  return stored;
}

export function relinkInboxThread(
  database: AppDatabase,
  tenant: TenantContext,
  threadId: string,
  input: {
    contactId: string;
    opportunityId?: string | null;
    referralId?: string | null;
    now?: Date;
  },
): EmailThread | undefined {
  const existing = getEmailThread(database, tenant, threadId);
  if (!existing) return undefined;
  const link = linkForContact(database, tenant, input.contactId);
  const now = input.now ?? new Date();
  const updated = upsertEmailThread(database, tenant, {
    accountId: existing.accountId,
    gmailThreadId: existing.gmailThreadId,
    subject: existing.subject,
    contactId: link.contactId,
    companyId: link.companyId,
    opportunityId: input.opportunityId ?? link.opportunityId,
    referralId: input.referralId ?? link.referralId,
    source: existing.source,
    matchStatus: "manual",
    matchReason: "Linked manually",
    suggestedContactIds: [],
    lastMessageAt: existing.lastMessageAt,
    now,
  });
  const messages = database
    .select()
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.workspaceId, tenant.workspaceId),
        eq(emailMessage.threadId, updated.id),
      ),
    )
    .orderBy(asc(emailMessage.sentAt), asc(emailMessage.id))
    .all();
  database.transaction((transaction) => {
    for (const message of messages) {
      ensureInboundInteraction(transaction, tenant, updated, message, now);
    }
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_THREAD_RELINKED",
      entityType: "email_thread",
      entityId: updated.id,
      payload: { contactId: updated.contactId },
    });
  });
  return updated;
}

export function confirmInboxMatch(
  database: AppDatabase,
  tenant: TenantContext,
  threadId: string,
  contactId: string,
  now = new Date(),
): EmailThread | undefined {
  const thread = getEmailThread(database, tenant, threadId);
  if (!thread) return undefined;
  if (
    thread.matchStatus !== "suggested" ||
    !thread.suggestedContactIdsJson.includes(contactId)
  ) {
    throw new InboxContentError("Choose one of this thread's suggested matches.");
  }
  const linked = relinkInboxThread(database, tenant, threadId, {
    contactId,
    now,
  });
  if (!linked) return undefined;
  return database
    .update(emailThread)
    .set({ matchReason: "Suggested match confirmed", updatedAt: now })
    .where(
      and(
        eq(emailThread.workspaceId, tenant.workspaceId),
        eq(emailThread.id, linked.id),
      ),
    )
    .returning()
    .get();
}

export function classifyInboxReply(
  database: AppDatabase,
  tenant: TenantContext,
  threadId: string,
  classification: ReplyClassification,
  now = new Date(),
) {
  if (!isReplyClassification(classification)) {
    throw new InboxContentError("Choose a valid reply classification.");
  }
  const thread = getEmailThread(database, tenant, threadId);
  if (!thread) return undefined;
  if (
    thread.contactId === null &&
    thread.companyId === null &&
    thread.opportunityId === null &&
    thread.referralId === null
  ) {
    throw new InboxContentError("Link this thread before classifying its reply.");
  }
  const message = database
    .select()
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.workspaceId, tenant.workspaceId),
        eq(emailMessage.threadId, thread.id),
        eq(emailMessage.direction, "inbound"),
      ),
    )
    .orderBy(desc(emailMessage.sentAt), desc(emailMessage.id))
    .get();
  if (!message) throw new InboxContentError("This thread has no inbound reply.");

  return database.transaction((transaction) => {
    const classified = transaction
      .update(emailMessage)
      .set({ classification })
      .where(
        and(
          eq(emailMessage.workspaceId, tenant.workspaceId),
          eq(emailMessage.id, message.id),
        ),
      )
      .returning()
      .get();
    const inbound = ensureInboundInteraction(
      transaction,
      tenant,
      thread,
      classified,
      now,
    );
    if (inbound) {
      transaction
        .update(interaction)
        .set({
          requiresReply: classification === "need_to_respond",
          replyResolvedAt:
            classification === "need_to_respond" ? null : now,
        })
        .where(
          and(
            eq(interaction.workspaceId, tenant.workspaceId),
            eq(interaction.id, inbound.id),
          ),
        )
        .run();
    }
    if (thread.referralId !== null) {
      const referralStage =
        classification === "referral_promised"
          ? "referral_promised"
          : classification === "referral_submitted"
            ? "referral_submitted"
            : classification === "declined"
              ? "declined"
              : null;
      if (referralStage) {
        transaction
          .update(referralRequest)
          .set({ stage: referralStage })
          .where(
            and(
              eq(referralRequest.workspaceId, tenant.workspaceId),
              eq(referralRequest.id, thread.referralId),
            ),
          )
          .run();
      }
    }
    if (thread.contactId !== null) {
      const networkingStatus =
        classification === "referral_promised"
          ? "referral_promised"
          : classification === "no_opening"
            ? "no_openings_currently"
            : classification === "follow_up_later"
              ? "follow_up_later"
              : null;
      if (networkingStatus) {
        transaction
          .update(contact)
          .set({ networkingStatus })
          .where(
            and(
              eq(contact.workspaceId, tenant.workspaceId),
              eq(contact.id, thread.contactId),
            ),
          )
          .run();
      }
    }
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_REPLY_CLASSIFIED",
      entityType: "email_message",
      entityId: classified.id,
      payload: { threadId: thread.id, classification },
    });
    return classified;
  });
}

export function listInboxThreads(
  database: AppDatabase,
  tenant: TenantContext,
  accountId?: string,
): EmailThread[] {
  if (accountId !== undefined) {
    const owned = database
      .select({ id: emailAccount.id })
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .get();
    if (!owned) return [];
  }
  return listEmailThreads(database, tenant, accountId);
}

export function getInboxThread(
  database: AppDatabase,
  tenant: TenantContext,
  threadId: string,
): EmailThreadWithMessages | undefined {
  return getEmailThread(database, tenant, threadId);
}
