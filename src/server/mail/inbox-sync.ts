import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, ne, or, lte } from "drizzle-orm";

import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import {
  emailAccount,
  emailThread,
  gmailRecoveryGeneration,
  gmailRecoveryThread,
} from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { readEmailAccountRefreshToken } from "../repos/email-accounts";
import { ingestSyncedThreadSnapshot } from "../repos/inbox-content";
import {
  GmailHistoryGapError,
  type GmailReadPort,
  type GmailThreadSnapshot,
} from "./gmail-read-port";

export { GmailHistoryGapError } from "./gmail-read-port";
export type {
  GmailMessageSnapshot,
  GmailReadPort,
  GmailThreadSnapshot,
} from "./gmail-read-port";

const RECENT_THREAD_LIMIT = 50;
const RECOVERY_THREAD_LIMIT = 20;
const RECOVERY_TICK_MS = 15_000;
const RECOVERY_LEASE_MS = 5 * 60_000;
const RECOVERY_RETRY_MS = 60_000;

export type InboxSyncDependencies = {
  port: GmailReadPort;
  tokenKey: string;
  now?: () => Date;
};

export type RecoveryDependencies = InboxSyncDependencies & { tickId: string };

export class InboxSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxSyncError";
  }
}

function ownedConnectedAccount(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
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
  if (!row) throw new InboxSyncError("Gmail account not found.");
  if (row.status !== "connected") {
    throw new InboxSyncError("Reconnect this Gmail account before syncing.");
  }
  return row;
}

function accountToken(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  tokenKey: string,
): string {
  const token = readEmailAccountRefreshToken(
    database,
    tenant,
    accountId,
    tokenKey,
  );
  if (!token) throw new InboxSyncError("Gmail account not found.");
  return token;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function persistThreadSnapshot(
  database: AppDatabase,
  tenant: TenantContext,
  account: typeof emailAccount.$inferSelect,
  snapshot: GmailThreadSnapshot,
  source: "sync" | "manual_import" = "sync",
): boolean {
  return ingestSyncedThreadSnapshot(
    database,
    tenant,
    account.id,
    snapshot,
    new Date(),
    source,
  ) !== undefined;
}

async function fetchAndPersistThreads(
  database: AppDatabase,
  tenant: TenantContext,
  account: typeof emailAccount.$inferSelect,
  refreshToken: string,
  port: GmailReadPort,
  gmailThreadIds: string[],
): Promise<number> {
  let imported = 0;
  for (const gmailThreadId of unique(gmailThreadIds)) {
    const snapshot = await port.getThread({ refreshToken, gmailThreadId });
    if (persistThreadSnapshot(database, tenant, account, snapshot)) {
      imported += 1;
    }
  }
  return imported;
}

function stampSuccessfulSync(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  historyId: string,
  now: Date,
  sequenceSafe: boolean,
): void {
  database.transaction((transaction) => {
    transaction
      .update(emailAccount)
      .set({
        lastHistoryId: historyId,
        lastSyncAt: now,
        ...(sequenceSafe ? { sequenceSafeAt: now } : {}),
        lastSyncError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
          eq(emailAccount.status, "connected"),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "GMAIL_INBOX_SYNCED",
      entityType: "email_account",
      entityId: accountId,
      payload: { sequenceSafe },
    });
  });
}

function openRecoveryGeneration(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  baselineHistoryId: string,
  alreadyReconciled: Set<string>,
  now: Date,
): string {
  return database.transaction((transaction) => {
    const existing = transaction
      .select({ id: gmailRecoveryGeneration.id })
      .from(gmailRecoveryGeneration)
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.accountId, accountId),
          ne(gmailRecoveryGeneration.status, "completed"),
        ),
      )
      .get();
    if (existing) return existing.id;

    const id = randomUUID();
    const tracked = transaction
      .select({ gmailThreadId: emailThread.gmailThreadId })
      .from(emailThread)
      .where(
        and(
          eq(emailThread.workspaceId, tenant.workspaceId),
          eq(emailThread.accountId, accountId),
        ),
      )
      .all()
      .map((row) => row.gmailThreadId)
      .filter((threadId) => !alreadyReconciled.has(threadId));
    transaction
      .insert(gmailRecoveryGeneration)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        accountId,
        baselineHistoryId,
        status: tracked.length === 0 ? "catching_up" : "sweeping",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const gmailThreadId of unique(tracked)) {
      transaction
        .insert(gmailRecoveryThread)
        .values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          generationId: id,
          accountId,
          gmailThreadId,
          status: "pending",
          createdAt: now,
        })
        .run();
    }
    logEvent(transaction, tenant, {
      at: now,
      kind: "GMAIL_RECOVERY_STARTED",
      entityType: "email_account",
      entityId: accountId,
      payload: { generationId: id, threadCount: tracked.length },
    });
    return id;
  });
}

async function initialSync(
  database: AppDatabase,
  tenant: TenantContext,
  account: typeof emailAccount.$inferSelect,
  refreshToken: string,
  dependencies: InboxSyncDependencies,
  now: Date,
) {
  const baseline = await dependencies.port.getProfileHistoryId({ refreshToken });
  const listed = await dependencies.port.listThreads({
    refreshToken,
    query: "newer_than:30d {in:inbox in:sent}",
    maxResults: RECENT_THREAD_LIMIT,
    pageToken: null,
  });
  let imported = await fetchAndPersistThreads(
    database,
    tenant,
    account,
    refreshToken,
    dependencies.port,
    listed.threadIds,
  );
  let pageToken: string | null = null;
  let historyId = baseline;
  do {
    const page = await dependencies.port.listHistory({
      refreshToken,
      startHistoryId: baseline,
      pageToken,
    });
    imported += await fetchAndPersistThreads(
      database,
      tenant,
      account,
      refreshToken,
      dependencies.port,
      page.threadIds,
    );
    historyId = page.historyId;
    pageToken = page.nextPageToken;
  } while (pageToken !== null);
  stampSuccessfulSync(
    database,
    tenant,
    account.id,
    historyId,
    now,
    true,
  );
  return { historyGap: false, importedThreadCount: imported };
}

async function syncInboxAccountInternal(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  dependencies: InboxSyncDependencies,
): Promise<{ historyGap: boolean; importedThreadCount: number }> {
  const account = ownedConnectedAccount(database, tenant, accountId);
  const refreshToken = accountToken(
    database,
    tenant,
    accountId,
    dependencies.tokenKey,
  );
  const now = dependencies.now?.() ?? new Date();
  if (account.lastHistoryId === null) {
    return initialSync(
      database,
      tenant,
      account,
      refreshToken,
      dependencies,
      now,
    );
  }

  try {
    let pageToken: string | null = null;
    let historyId = account.lastHistoryId;
    const changedThreadIds: string[] = [];
    do {
      const page = await dependencies.port.listHistory({
        refreshToken,
        startHistoryId: account.lastHistoryId,
        pageToken,
      });
      changedThreadIds.push(...page.threadIds);
      historyId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken !== null);
    const importedThreadCount = await fetchAndPersistThreads(
      database,
      tenant,
      account,
      refreshToken,
      dependencies.port,
      changedThreadIds,
    );
    stampSuccessfulSync(
      database,
      tenant,
      account.id,
      historyId,
      now,
      true,
    );
    return { historyGap: false, importedThreadCount };
  } catch (error) {
    if (!(error instanceof GmailHistoryGapError)) throw error;
  }

  const baselineHistoryId = await dependencies.port.getProfileHistoryId({
    refreshToken,
  });
  const page = await dependencies.port.listThreads({
    refreshToken,
    query: "newer_than:30d {in:inbox in:sent}",
    maxResults: RECENT_THREAD_LIMIT,
    pageToken: null,
  });
  const importedThreadCount = await fetchAndPersistThreads(
    database,
    tenant,
    account,
    refreshToken,
    dependencies.port,
    page.threadIds,
  );
  openRecoveryGeneration(
    database,
    tenant,
    account.id,
    baselineHistoryId,
    new Set(page.threadIds),
    now,
  );
  stampSuccessfulSync(
    database,
    tenant,
    account.id,
    baselineHistoryId,
    now,
    false,
  );
  return { historyGap: true, importedThreadCount };
}

export async function syncInboxAccount(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  dependencies: InboxSyncDependencies,
): Promise<{ historyGap: boolean; importedThreadCount: number }> {
  try {
    return await syncInboxAccountInternal(
      database,
      tenant,
      accountId,
      dependencies,
    );
  } catch (error) {
    const account = database
      .select({ id: emailAccount.id })
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .get();
    if (account) {
      const at = dependencies.now?.() ?? new Date();
      database
        .update(emailAccount)
        .set({
          lastSyncError:
            error instanceof Error ? error.message.slice(0, 500) : "Gmail sync failed.",
          updatedAt: at,
        })
        .where(
          and(
            eq(emailAccount.workspaceId, tenant.workspaceId),
            eq(emailAccount.id, accountId),
          ),
        )
        .run();
    }
    throw error;
  }
}

function claimRecovery(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  tickId: string,
  now: Date,
) {
  return database.transaction((transaction) => {
    const generation = transaction
      .select()
      .from(gmailRecoveryGeneration)
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.accountId, accountId),
          ne(gmailRecoveryGeneration.status, "completed"),
          or(
            isNull(gmailRecoveryGeneration.nextRetryAt),
            lte(gmailRecoveryGeneration.nextRetryAt, now),
          ),
        ),
      )
      .orderBy(asc(gmailRecoveryGeneration.createdAt))
      .get();
    if (!generation) return undefined;
    if (
      generation.leaseOwner !== null &&
      generation.leaseOwner !== tickId &&
      generation.leaseExpiresAt !== null &&
      generation.leaseExpiresAt.valueOf() > now.valueOf()
    ) {
      return undefined;
    }
    return transaction
      .update(gmailRecoveryGeneration)
      .set({
        leaseOwner: tickId,
        leaseExpiresAt: new Date(now.valueOf() + RECOVERY_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.id, generation.id),
          or(
            isNull(gmailRecoveryGeneration.leaseOwner),
            eq(gmailRecoveryGeneration.leaseOwner, tickId),
            lte(gmailRecoveryGeneration.leaseExpiresAt, now),
          ),
        ),
      )
      .returning()
      .get();
  });
}

function releaseRecoveryLease(
  database: AppDatabase,
  tenant: TenantContext,
  generationId: string,
  tickId: string,
  now: Date,
  retry = false,
): void {
  database
    .update(gmailRecoveryGeneration)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      nextRetryAt: retry ? new Date(now.valueOf() + RECOVERY_RETRY_MS) : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
        eq(gmailRecoveryGeneration.id, generationId),
        eq(gmailRecoveryGeneration.leaseOwner, tickId),
      ),
    )
    .run();
}

export async function runMailboxRecoveryBatch(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  dependencies: RecoveryDependencies,
): Promise<{
  reconciled: number;
  completed: boolean;
  quotaUnits: number;
  claimed: boolean;
}> {
  const account = ownedConnectedAccount(database, tenant, accountId);
  const refreshToken = accountToken(
    database,
    tenant,
    accountId,
    dependencies.tokenKey,
  );
  const startedAt = dependencies.now?.() ?? new Date();
  const generation = claimRecovery(
    database,
    tenant,
    accountId,
    dependencies.tickId,
    startedAt,
  );
  if (!generation) {
    return { reconciled: 0, completed: false, quotaUnits: 0, claimed: false };
  }

  let reconciled = 0;
  let quotaUnits = 0;
  try {
    const pending = database
      .select()
      .from(gmailRecoveryThread)
      .where(
        and(
          eq(gmailRecoveryThread.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryThread.generationId, generation.id),
          eq(gmailRecoveryThread.status, "pending"),
        ),
      )
      .orderBy(asc(gmailRecoveryThread.createdAt), asc(gmailRecoveryThread.id))
      .limit(RECOVERY_THREAD_LIMIT)
      .all();
    for (const item of pending) {
      const current = dependencies.now?.() ?? new Date();
      if (current.valueOf() - startedAt.valueOf() >= RECOVERY_TICK_MS) break;
      const snapshot = await dependencies.port.getThread({
        refreshToken,
        gmailThreadId: item.gmailThreadId,
      });
      quotaUnits += 40;
      persistThreadSnapshot(database, tenant, account, snapshot);
      database
        .update(gmailRecoveryThread)
        .set({ status: "reconciled", reconciledAt: current })
        .where(
          and(
            eq(gmailRecoveryThread.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryThread.id, item.id),
            eq(gmailRecoveryThread.status, "pending"),
          ),
        )
        .run();
      reconciled += 1;
    }

    const pendingCount = database
      .select({ id: gmailRecoveryThread.id })
      .from(gmailRecoveryThread)
      .where(
        and(
          eq(gmailRecoveryThread.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryThread.generationId, generation.id),
          eq(gmailRecoveryThread.status, "pending"),
        ),
      )
      .all().length;
    if (pendingCount > 0) {
      releaseRecoveryLease(
        database,
        tenant,
        generation.id,
        dependencies.tickId,
        dependencies.now?.() ?? new Date(),
      );
      return { reconciled, completed: false, quotaUnits, claimed: true };
    }

    database
      .update(gmailRecoveryGeneration)
      .set({ status: "catching_up", updatedAt: dependencies.now?.() ?? new Date() })
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.id, generation.id),
        ),
      )
      .run();
    const currentGeneration = database
      .select()
      .from(gmailRecoveryGeneration)
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.id, generation.id),
        ),
      )
      .get()!;
    const history = await dependencies.port.listHistory({
      refreshToken,
      startHistoryId: currentGeneration.baselineHistoryId,
      pageToken: currentGeneration.catchUpPageToken,
    });
    quotaUnits += 2;
    const catchUpThreadIds = unique(history.threadIds);
    if (catchUpThreadIds.length > 0) {
      const at = dependencies.now?.() ?? new Date();
      database.transaction((transaction) => {
        for (const gmailThreadId of catchUpThreadIds) {
          transaction
            .insert(gmailRecoveryThread)
            .values({
              id: randomUUID(),
              workspaceId: tenant.workspaceId,
              generationId: generation.id,
              accountId,
              gmailThreadId,
              status: "pending",
              createdAt: at,
            })
            .onConflictDoNothing()
            .run();
        }
        transaction
          .update(gmailRecoveryGeneration)
          .set({
            status: "sweeping",
            ...(history.nextPageToken === null
              ? { baselineHistoryId: history.historyId }
              : {}),
            catchUpPageToken: history.nextPageToken,
            updatedAt: at,
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
              eq(gmailRecoveryGeneration.id, generation.id),
              eq(gmailRecoveryGeneration.leaseOwner, dependencies.tickId),
            ),
          )
          .run();
      });
      return { reconciled, completed: false, quotaUnits, claimed: true };
    }
    if (history.nextPageToken !== null) {
      database
        .update(gmailRecoveryGeneration)
        .set({
          catchUpPageToken: history.nextPageToken,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: dependencies.now?.() ?? new Date(),
        })
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.id, generation.id),
            eq(gmailRecoveryGeneration.leaseOwner, dependencies.tickId),
          ),
        )
        .run();
      return { reconciled, completed: false, quotaUnits, claimed: true };
    }

    const completedAt = dependencies.now?.() ?? new Date();
    database.transaction((transaction) => {
      const completionState = transaction
        .select({ deferredThread: gmailRecoveryGeneration.deferredThread })
        .from(gmailRecoveryGeneration)
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.id, generation.id),
          ),
        )
        .get();
      const sequenceSafe = completionState?.deferredThread !== true;
      transaction
        .update(gmailRecoveryGeneration)
        .set({
          status: "completed",
          catchUpPageToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.id, generation.id),
            eq(gmailRecoveryGeneration.leaseOwner, dependencies.tickId),
          ),
        )
        .run();
      if (sequenceSafe) {
        transaction
          .update(emailAccount)
          .set({
            lastHistoryId: history.historyId,
            sequenceSafeAt: completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(emailAccount.workspaceId, tenant.workspaceId),
              eq(emailAccount.id, accountId),
              eq(emailAccount.status, "connected"),
            ),
          )
          .run();
      }
      logEvent(transaction, tenant, {
        at: completedAt,
        kind: "GMAIL_RECOVERY_COMPLETED",
        entityType: "email_account",
        entityId: accountId,
        payload: {
          generationId: generation.id,
          sequenceSafe,
        },
      });
    });
    return { reconciled, completed: true, quotaUnits, claimed: true };
  } catch (error) {
    releaseRecoveryLease(
      database,
      tenant,
      generation.id,
      dependencies.tickId,
      dependencies.now?.() ?? new Date(),
      true,
    );
    throw error;
  }
}

export function addThreadToOpenRecovery(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  gmailThreadId: string,
  now = new Date(),
): "added" | "deferred" | "no_generation" {
  return database.transaction((transaction) => {
    let generation = transaction
      .select()
      .from(gmailRecoveryGeneration)
      .where(
        and(
          eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
          eq(gmailRecoveryGeneration.accountId, accountId),
          ne(gmailRecoveryGeneration.status, "completed"),
        ),
      )
      .orderBy(asc(gmailRecoveryGeneration.createdAt))
      .get();
    if (!generation) {
      const account = transaction
        .select({ lastHistoryId: emailAccount.lastHistoryId })
        .from(emailAccount)
        .where(
          and(
            eq(emailAccount.workspaceId, tenant.workspaceId),
            eq(emailAccount.id, accountId),
            eq(emailAccount.status, "connected"),
          ),
        )
        .get();
      if (!account?.lastHistoryId) return "no_generation";
      const generationId = randomUUID();
      transaction
        .insert(gmailRecoveryGeneration)
        .values({
          id: generationId,
          workspaceId: tenant.workspaceId,
          accountId,
          baselineHistoryId: account.lastHistoryId,
          status: "sweeping",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      generation = transaction
        .select()
        .from(gmailRecoveryGeneration)
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.id, generationId),
          ),
        )
        .get()!;
    }
    if (generation.status === "catching_up") {
      transaction
        .update(gmailRecoveryGeneration)
        .set({ deferredThread: true, updatedAt: now })
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.id, generation.id),
          ),
        )
        .run();
      const later = transaction
        .select()
        .from(gmailRecoveryGeneration)
        .where(
          and(
            eq(gmailRecoveryGeneration.workspaceId, tenant.workspaceId),
            eq(gmailRecoveryGeneration.accountId, accountId),
            ne(gmailRecoveryGeneration.status, "completed"),
          ),
        )
        .all()
        .find((row) => row.id !== generation.id);
      const nextGenerationId = later?.id ?? randomUUID();
      if (!later) {
        transaction
          .insert(gmailRecoveryGeneration)
          .values({
            id: nextGenerationId,
            workspaceId: tenant.workspaceId,
            accountId,
            baselineHistoryId: generation.baselineHistoryId,
            status: "sweeping",
            createdAt: new Date(now.valueOf() + 1),
            updatedAt: now,
          })
          .run();
      }
      transaction
        .insert(gmailRecoveryThread)
        .values({
          id: randomUUID(),
          workspaceId: tenant.workspaceId,
          generationId: nextGenerationId,
          accountId,
          gmailThreadId,
          status: "pending",
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      return "deferred";
    }
    transaction
      .insert(gmailRecoveryThread)
      .values({
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        generationId: generation.id,
        accountId,
        gmailThreadId,
        status: "pending",
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    return "added";
  });
}

export const GMAIL_SYNC_LIMITS = Object.freeze({
  recentThreads: RECENT_THREAD_LIMIT,
  recoveryThreadsPerTick: RECOVERY_THREAD_LIMIT,
  recoveryTickMs: RECOVERY_TICK_MS,
  recoveryLeaseMs: RECOVERY_LEASE_MS,
  requestDeadlineMs: 10_000,
});
