import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  DIGEST_SUBJECT,
  digestLocalDate,
  digestTickAction,
  formatDigestBody,
  parseDigestHour,
  type DigestCounts,
  type DigestOutcome,
} from "../../domain/digest";
import { logEvent } from "../db/activity";
import type { AppDatabase, AppTransaction } from "../db/client";
import { digestRun, emailAccount, settings, workspace } from "../db/schema";
import { createTenantContext, type TenantContext } from "../db/tenant";
import { createQueueMessage, SendSafetyError } from "./send-safety";
import { getTodaySnapshot } from "./today";

export class DigestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DigestInputError";
  }
}

export type DigestPolicyView = {
  digestHour: number | null;
  digestEmailEnabled: boolean;
  digestAccountId: string | null;
  digestAccountEmail: string | null;
  selectedAccountStatus: "connected" | "disconnected" | "error" | null;
  selectedAccountLiveEmail: string | null;
};

export type DigestRunView = typeof digestRun.$inferSelect;

export type DigestPreview = {
  asOfOn: string;
  timeZone: string;
  counts: DigestCounts;
  body: string;
  lastRun: DigestRunView | null;
};

export type UpdateDigestPolicyInput = {
  digestHour?: number | string | null;
  digestAccountId?: string | null;
  digestEmailEnabled?: boolean;
  now?: Date;
};

const ALLOWED_INPUT_KEYS = new Set([
  "digestHour",
  "digestAccountId",
  "digestEmailEnabled",
  "now",
]);

function countsFromToday(
  database: AppDatabase,
  tenant: TenantContext,
  now: Date,
): { asOfOn: string; timeZone: string; counts: DigestCounts; body: string } {
  const snapshot = getTodaySnapshot(database, tenant, { now });
  const counts: DigestCounts = {
    followUps: snapshot.stats.followUps,
    deadlines: snapshot.stats.deadlines,
    oa: snapshot.pipeline.oa,
    replies: snapshot.stats.needReply,
    interviewsToday: snapshot.stats.interviewsToday,
  };
  return {
    asOfOn: snapshot.asOfOn,
    timeZone: snapshot.timeZone,
    counts,
    body: formatDigestBody(counts),
  };
}

function toPolicyView(
  row: typeof settings.$inferSelect,
  account: {
    status: "connected" | "disconnected" | "error";
    email: string;
  } | null,
): DigestPolicyView {
  return {
    digestHour: row.digestHour ?? null,
    digestEmailEnabled: row.digestEmailEnabled,
    digestAccountId: row.digestAccountId ?? null,
    digestAccountEmail: row.digestAccountEmail ?? null,
    selectedAccountStatus: account?.status ?? null,
    selectedAccountLiveEmail: account?.email ?? null,
  };
}

function ownedAccount(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
  accountId: string,
) {
  return database
    .select({
      id: emailAccount.id,
      email: emailAccount.email,
      status: emailAccount.status,
    })
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
}

export function readDigestPolicy(
  database: AppDatabase,
  tenant: TenantContext,
): DigestPolicyView {
  const row = database
    .select()
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  if (!row) {
    throw new DigestInputError("This workspace has no settings row.");
  }
  const account = row.digestAccountId
    ? ownedAccount(database, tenant, row.digestAccountId)
    : null;
  return toPolicyView(row, account ?? null);
}

export function readDigestPreview(
  database: AppDatabase,
  tenant: TenantContext,
  now = new Date(),
): DigestPreview {
  const snapshot = countsFromToday(database, tenant, now);
  const lastRun = database
    .select()
    .from(digestRun)
    .where(eq(digestRun.workspaceId, tenant.workspaceId))
    .all()
    .sort((left, right) => right.at.valueOf() - left.at.valueOf())[0] ?? null;
  return { ...snapshot, lastRun };
}

export function listDigestRuns(
  database: AppDatabase,
  tenant: TenantContext,
): DigestRunView[] {
  return database
    .select()
    .from(digestRun)
    .where(eq(digestRun.workspaceId, tenant.workspaceId))
    .all()
    .sort((left, right) => right.at.valueOf() - left.at.valueOf());
}

export function updateDigestPolicy(
  database: AppDatabase,
  tenant: TenantContext,
  input: UpdateDigestPolicyInput,
): DigestPolicyView {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new DigestInputError(`Digest settings do not accept ${key}.`);
    }
  }

  const now = input.now ?? new Date();
  let digestHour: number | null | undefined;
  if (input.digestHour !== undefined) {
    try {
      digestHour = parseDigestHour(input.digestHour);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new DigestInputError(error.message);
      }
      throw error;
    }
  }

  return database.transaction((transaction) => {
    const before = transaction
      .select()
      .from(settings)
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .get();
    if (!before) {
      throw new DigestInputError("This workspace has no settings row.");
    }

    const digestAccountId =
      input.digestAccountId === undefined
        ? (before.digestAccountId ?? null)
        : input.digestAccountId?.trim() || null;
    const account = digestAccountId
      ? ownedAccount(transaction, tenant, digestAccountId)
      : null;
    if (digestAccountId && !account) {
      throw new DigestInputError("Gmail account not found.");
    }

    const accountChanged =
      digestAccountId !== (before.digestAccountId ?? null);
    let digestEmailEnabled =
      input.digestEmailEnabled === undefined
        ? before.digestEmailEnabled
        : input.digestEmailEnabled;
    let digestAccountEmail = before.digestAccountEmail ?? null;

    if (accountChanged) {
      digestEmailEnabled =
        input.digestEmailEnabled === true ? true : false;
      digestAccountEmail = null;
    }

    if (digestEmailEnabled) {
      if (!account || account.status !== "connected") {
        throw new DigestInputError(
          "Select one connected Gmail account before enabling the morning digest.",
        );
      }
      digestAccountEmail = account.email;
    }

    const row = transaction
      .update(settings)
      .set({
        digestHour: digestHour === undefined ? before.digestHour : digestHour,
        digestAccountId,
        digestAccountEmail,
        digestEmailEnabled,
      })
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .returning()
      .get();

    if (
      before.digestEmailEnabled !== row.digestEmailEnabled ||
      (before.digestAccountId ?? null) !== (row.digestAccountId ?? null)
    ) {
      logEvent(transaction, tenant, {
        at: now,
        kind: "DIGEST_POLICY_CHANGED",
        entityType: "workspace",
        entityId: tenant.workspaceId,
        payload: {
          enabled: row.digestEmailEnabled,
          accountId: row.digestAccountId,
        },
      });
    }

    return toPolicyView(row, account ?? null);
  });
}

function queuedLocalDateFor(
  transaction: AppTransaction,
  tenant: TenantContext,
  localDate: string,
): string | null {
  const row = transaction
    .select({ outcome: digestRun.outcome, localDate: digestRun.localDate })
    .from(digestRun)
    .where(
      and(
        eq(digestRun.workspaceId, tenant.workspaceId),
        eq(digestRun.localDate, localDate),
      ),
    )
    .get();
  return row?.outcome === "queued" ? row.localDate : null;
}

function upsertDigestRun(
  transaction: AppTransaction,
  tenant: TenantContext,
  input: {
    localDate: string;
    at: Date;
    outcome: DigestOutcome;
    accountId: string | null;
    recipient: string | null;
    queueId: string | null;
    counts: DigestCounts;
    body: string;
  },
): DigestRunView {
  const existing = transaction
    .select()
    .from(digestRun)
    .where(
      and(
        eq(digestRun.workspaceId, tenant.workspaceId),
        eq(digestRun.localDate, input.localDate),
      ),
    )
    .get();
  if (existing) {
    return transaction
      .update(digestRun)
      .set({
        at: input.at,
        outcome: input.outcome,
        accountId: input.accountId,
        recipient: input.recipient,
        queueId: input.queueId,
        countsJson: input.counts,
        body: input.body,
      })
      .where(
        and(
          eq(digestRun.workspaceId, tenant.workspaceId),
          eq(digestRun.id, existing.id),
        ),
      )
      .returning()
      .get();
  }
  return transaction
    .insert(digestRun)
    .values({
      id: randomUUID(),
      workspaceId: tenant.workspaceId,
      localDate: input.localDate,
      at: input.at,
      outcome: input.outcome,
      accountId: input.accountId,
      recipient: input.recipient,
      queueId: input.queueId,
      countsJson: input.counts,
      body: input.body,
    })
    .returning()
    .get();
}

function disableDigestPolicy(
  transaction: AppTransaction,
  tenant: TenantContext,
) {
  transaction
    .update(settings)
    .set({ digestEmailEnabled: false })
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .run();
}

function processWorkspaceDigest(
  database: AppDatabase,
  tenant: TenantContext,
  now: Date,
): void {
  const row = database
    .select()
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  if (!row) return;

  const account = row.digestAccountId
    ? database
        .select({
          id: emailAccount.id,
          email: emailAccount.email,
          status: emailAccount.status,
        })
        .from(emailAccount)
        .where(
          and(
            eq(emailAccount.workspaceId, tenant.workspaceId),
            eq(emailAccount.id, row.digestAccountId),
          ),
        )
        .get()
    : null;

  const localDate = digestLocalDate(row.timezone, now);
  const queuedLocalDate = database.transaction((transaction) =>
    queuedLocalDateFor(transaction, tenant, localDate),
  );
  const action = digestTickAction({
    now,
    policy: {
      enabled: row.digestEmailEnabled,
      accountId: row.digestAccountId ?? null,
      approvedEmail: row.digestAccountEmail ?? null,
      digestHour: row.digestHour ?? null,
      timeZone: row.timezone,
      quietStart: row.quietStart ?? null,
      quietEnd: row.quietEnd ?? null,
    },
    accountStatus: account?.status ?? null,
    currentAccountEmail: account?.email ?? null,
    queuedLocalDate,
  });

  if (action === "skip_hour" || action === "skip_already_queued") {
    return;
  }

  const preview = countsFromToday(database, tenant, now);
  const outcome: DigestOutcome =
    action === "enqueue"
      ? "queued"
      : action === "skip_disconnected"
        ? "skipped_disconnected"
        : action === "skip_quiet"
          ? "skipped_quiet"
          : "previewed";

  database.transaction((transaction) => {
    if (queuedLocalDateFor(transaction, tenant, localDate)) {
      return;
    }

    if (action === "skip_disconnected") {
      disableDigestPolicy(transaction, tenant);
      upsertDigestRun(transaction, tenant, {
        localDate,
        at: now,
        outcome: "skipped_disconnected",
        accountId: row.digestAccountId ?? null,
        recipient: account?.email ?? row.digestAccountEmail ?? null,
        queueId: null,
        counts: preview.counts,
        body: preview.body,
      });
      logEvent(transaction, tenant, {
        at: now,
        kind: "DIGEST_SKIPPED",
        entityType: "workspace",
        entityId: tenant.workspaceId,
        payload: { reason: "disconnected", localDate },
      });
      return;
    }

    if (action !== "enqueue") {
      upsertDigestRun(transaction, tenant, {
        localDate,
        at: now,
        outcome,
        accountId: row.digestAccountId ?? null,
        recipient: null,
        queueId: null,
        counts: preview.counts,
        body: preview.body,
      });
      return;
    }

    if (!account) {
      return;
    }

    try {
      const queued = createQueueMessage(transaction, tenant, {
        accountId: account.id,
        origin: "self_digest",
        recipient: account.email,
        subject: DIGEST_SUBJECT,
        body: preview.body,
        attachmentVersionIds: [],
        sendAt: now,
        approvalKind: "self_digest_policy",
        now,
      });
      upsertDigestRun(transaction, tenant, {
        localDate,
        at: now,
        outcome: "queued",
        accountId: account.id,
        recipient: account.email,
        queueId: queued.id,
        counts: preview.counts,
        body: preview.body,
      });
      logEvent(transaction, tenant, {
        at: now,
        kind: "DIGEST_QUEUED",
        entityType: "send_queue",
        entityId: queued.id,
        payload: { localDate, accountId: account.id },
      });
    } catch (error) {
      if (!(error instanceof SendSafetyError)) {
        throw error;
      }
      disableDigestPolicy(transaction, tenant);
      upsertDigestRun(transaction, tenant, {
        localDate,
        at: now,
        outcome: "skipped_disconnected",
        accountId: account.id,
        recipient: account.email,
        queueId: null,
        counts: preview.counts,
        body: preview.body,
      });
    }
  });
}

export function processDueDigests(database: AppDatabase, now = new Date()): void {
  const rows = database
    .select({
      workspaceId: workspace.id,
      ownerUserId: workspace.ownerUserId,
    })
    .from(workspace)
    .all();
  for (const row of rows) {
    processWorkspaceDigest(
      database,
      createTenantContext(row.ownerUserId, row.workspaceId),
      now,
    );
  }
}
