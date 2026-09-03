import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailAccount } from "../db/schema";
import { connectEmailAccount } from "../repos/email-accounts";
import { getEmailThread, upsertEmailThread } from "../repos/email-content";
import { createContact } from "../repos/contacts";
import {
  GmailHistoryGapError,
  addThreadToOpenRecovery,
  runMailboxRecoveryBatch,
  syncInboxAccount,
  type GmailReadPort,
  type GmailThreadSnapshot,
} from "./inbox-sync";

const TOKEN_KEY = Buffer.alloc(32, 14).toString("base64");
const NOW = new Date("2026-09-03T13:00:00.000Z");

function snapshot(threadId: string, messageId = `${threadId}-message`): GmailThreadSnapshot {
  return {
    gmailThreadId: threadId,
    historyId: "history-latest",
    messages: [
      {
        gmailId: messageId,
        rfcMessageId: `<${messageId}@invalid.test>`,
        fromEmail: "recruiter@invalid.test",
        to: ["sender@invalid.test"],
        subject: `Subject ${threadId}`,
        body: "Plain text reply",
        sentAt: new Date("2026-09-03T12:55:00.000Z"),
      },
    ],
  };
}

function port(overrides: Partial<GmailReadPort> = {}): GmailReadPort {
  return {
    getProfileHistoryId: async () => "history-baseline",
    listHistory: async ({ startHistoryId }) => ({
      historyId: `${startHistoryId}-next`,
      threadIds: [],
      nextPageToken: null,
    }),
    listThreads: async () => ({ threadIds: [], nextPageToken: null }),
    getThread: async ({ gmailThreadId }) => snapshot(gmailThreadId),
    ...overrides,
  };
}

describe("account-scoped Gmail inbox sync", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function fixture() {
    const value = createTenantTestFixture();
    cleanups.push(value.dispose);
    const accountA = connectEmailAccount(
      value.client.db,
      value.tenantA,
      {
        googleSub: "google-a",
        email: "sender-a@invalid.test",
        refreshToken: "refresh-a",
        now: new Date("2026-09-03T12:00:00.000Z"),
      },
      TOKEN_KEY,
    );
    const accountASecond = connectEmailAccount(
      value.client.db,
      value.tenantA,
      {
        googleSub: "google-a-second",
        email: "sender-b@invalid.test",
        refreshToken: "refresh-b",
        now: new Date("2026-09-03T12:01:00.000Z"),
      },
      TOKEN_KEY,
    );
    const accountB = connectEmailAccount(
      value.client.db,
      value.tenantB,
      {
        googleSub: "google-foreign",
        email: "foreign@invalid.test",
        refreshToken: "refresh-foreign",
        now: new Date("2026-09-03T12:02:00.000Z"),
      },
      TOKEN_KEY,
    );
    createContact(value.client.db, value.tenantA, {
      id: "known-recruiter-a",
      name: "Known recruiter",
      methods: [{ kind: "email", value: "recruiter@invalid.test" }],
      now: new Date("2026-09-03T12:03:00.000Z"),
    });
    return { ...value, accountA, accountASecond, accountB };
  }

  function seedCursor(
    value: ReturnType<typeof fixture>,
    accountId: string,
    historyId: string,
    safeAt = new Date("2026-09-03T12:30:00.000Z"),
  ) {
    value.client.sqlite
      .prepare(
        "update email_account set last_history_id = ?, last_sync_at = ?, sequence_safe_at = ? where workspace_id = ? and id = ?",
      )
      .run(historyId, safeAt.valueOf(), safeAt.valueOf(), value.tenantA.workspaceId, accountId);
  }

  it("keeps two owned account cursors, tokens and thread identities independent", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "cursor-a");
    seedCursor(value, value.accountASecond.id, "cursor-b");
    const calls: string[] = [];
    const fake = port({
      listHistory: async ({ refreshToken, startHistoryId }) => {
        calls.push(`${refreshToken}:${startHistoryId}`);
        return {
          historyId: `${startHistoryId}-next`,
          threadIds: ["same-gmail-thread"],
          nextPageToken: null,
        };
      },
    });

    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: fake,
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });
    await syncInboxAccount(
      value.client.db,
      value.tenantA,
      value.accountASecond.id,
      { port: fake, tokenKey: TOKEN_KEY, now: () => NOW },
    );

    expect(calls).toEqual(["refresh-a:cursor-a", "refresh-b:cursor-b"]);
    const rows = value.client.sqlite
      .prepare(
        "select id, last_history_id as historyId from email_account where workspace_id = ? order by email_normalized",
      )
      .all(value.tenantA.workspaceId) as { id: string; historyId: string }[];
    expect(rows.map((row) => row.historyId)).toEqual([
      "cursor-a-next",
      "cursor-b-next",
    ]);
    expect(
      value.client.sqlite
        .prepare("select count(*) as count from email_thread where gmail_thread_id = ?")
        .get("same-gmail-thread"),
    ).toEqual({ count: 2 });
  });

  it("advances neither stamp when an incremental sync throws", async () => {
    const value = fixture();
    const before = new Date("2026-09-03T12:30:00.000Z");
    seedCursor(value, value.accountA.id, "cursor-a", before);

    await expect(
      syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
        port: port({ listHistory: async () => { throw new Error("offline"); } }),
        tokenKey: TOKEN_KEY,
        now: () => NOW,
      }),
    ).rejects.toThrow("offline");

    const row = value.client.db
      .select()
      .from(emailAccount)
      .all()
      .find((item) => item.id === value.accountA.id)!;
    expect(row.lastHistoryId).toBe("cursor-a");
    expect(row.lastSyncAt).toEqual(before);
    expect(row.sequenceSafeAt).toEqual(before);
  });

  it("uses a bounded list on a history gap without certifying sequence safety", async () => {
    const value = fixture();
    const before = new Date("2026-09-03T12:30:00.000Z");
    seedCursor(value, value.accountA.id, "expired-cursor", before);
    const old = upsertEmailThread(value.client.db, value.tenantA, {
      accountId: value.accountA.id,
      gmailThreadId: "old-enrollment-thread",
      subject: "Older thread",
      lastMessageAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    const fake = port({
      listHistory: async () => { throw new GmailHistoryGapError(); },
      getProfileHistoryId: async () => "fresh-baseline",
      listThreads: async ({ maxResults }) => {
        expect(maxResults).toBe(50);
        return { threadIds: ["recent-thread"], nextPageToken: null };
      },
    });

    const result = await syncInboxAccount(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: fake, tokenKey: TOKEN_KEY, now: () => NOW },
    );

    expect(result).toMatchObject({ historyGap: true, importedThreadCount: 1 });
    const account = value.client.db
      .select()
      .from(emailAccount)
      .all()
      .find((item) => item.id === value.accountA.id)!;
    expect(account.lastHistoryId).toBe("fresh-baseline");
    expect(account.lastSyncAt).toEqual(NOW);
    expect(account.sequenceSafeAt).toEqual(before);
    expect(getEmailThread(value.client.db, value.tenantA, old.id)).toBeDefined();
  });

  it("leases and resumes a bounded recovery generation before advancing safety", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "expired-cursor");
    for (let index = 0; index < 21; index += 1) {
      upsertEmailThread(value.client.db, value.tenantA, {
        accountId: value.accountA.id,
        gmailThreadId: `tracked-${index.toString().padStart(2, "0")}`,
        subject: `Tracked ${index}`,
        lastMessageAt: new Date("2026-08-20T10:00:00.000Z"),
      });
    }
    const fake = port({
      listHistory: async () => { throw new GmailHistoryGapError(); },
      getProfileHistoryId: async () => "fresh-baseline",
    });
    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: fake,
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });

    const first = await runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: fake, tokenKey: TOKEN_KEY, tickId: "tick-a", now: () => NOW },
    );
    expect(first).toMatchObject({ reconciled: 20, completed: false, quotaUnits: 800 });
    const second = await runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      {
        port: port({
          listHistory: async ({ startHistoryId, pageToken }) => {
            expect(startHistoryId).toBe("fresh-baseline");
            expect(pageToken).toBeNull();
            return { historyId: "catch-up", threadIds: [], nextPageToken: null };
          },
        }),
        tokenKey: TOKEN_KEY,
        tickId: "tick-b",
        now: () => new Date("2026-09-03T13:06:00.000Z"),
      },
    );
    expect(second).toMatchObject({ reconciled: 1, completed: true });
    const account = value.client.db
      .select()
      .from(emailAccount)
      .all()
      .find((item) => item.id === value.accountA.id)!;
    expect(account.sequenceSafeAt).toEqual(new Date("2026-09-03T13:06:00.000Z"));
  });

  it("treats a foreign workspace account as missing without advancing or importing", async () => {
    const value = fixture();
    const calls: string[] = [];
    await expect(
      syncInboxAccount(value.client.db, value.tenantA, value.accountB.id, {
        port: port({ listHistory: async () => { calls.push("called"); return { historyId: "x", threadIds: [], nextPageToken: null }; } }),
        tokenKey: TOKEN_KEY,
        now: () => NOW,
      }),
    ).rejects.toThrow("Gmail account not found.");
    expect(calls).toEqual([]);
    expect(value.client.sqlite.prepare("select count(*) as count from email_thread").get()).toEqual({ count: 0 });
  });

  it("allows only one live recovery lease and lets an expired owner be replaced", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "expired-cursor");
    upsertEmailThread(value.client.db, value.tenantA, {
      accountId: value.accountA.id,
      gmailThreadId: "leased-thread",
      subject: "Leased",
      lastMessageAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    let historyCalls = 0;
    let releaseThread!: () => void;
    const held = new Promise<void>((resolve) => { releaseThread = resolve; });
    const fake = port({
      listHistory: async () => {
        historyCalls += 1;
        if (historyCalls === 1) throw new GmailHistoryGapError();
        return { historyId: "caught-up", threadIds: [], nextPageToken: null };
      },
      getProfileHistoryId: async () => "baseline",
      getThread: async ({ gmailThreadId }) => {
        await held;
        return snapshot(gmailThreadId);
      },
    });
    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: fake,
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });
    const first = runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: fake, tokenKey: TOKEN_KEY, tickId: "live-owner", now: () => NOW },
    );
    await Promise.resolve();
    await expect(
      runMailboxRecoveryBatch(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        { port: fake, tokenKey: TOKEN_KEY, tickId: "other-owner", now: () => NOW },
      ),
    ).resolves.toMatchObject({ claimed: false, reconciled: 0 });
    releaseThread();
    await expect(first).resolves.toMatchObject({ claimed: true, completed: true });

    value.client.sqlite
      .prepare(
        "update gmail_recovery_generation set status = 'sweeping', completed_at = null, lease_owner = 'dead-owner', lease_expires_at = ?, updated_at = ? where workspace_id = ? and account_id = ?",
      )
      .run(
        new Date("2026-09-03T13:05:00.000Z").valueOf(),
        NOW.valueOf(),
        value.tenantA.workspaceId,
        value.accountA.id,
      );
    await expect(
      runMailboxRecoveryBatch(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        {
          port: fake,
          tokenKey: TOKEN_KEY,
          tickId: "replacement",
          now: () => new Date("2026-09-03T13:04:59.000Z"),
        },
      ),
    ).resolves.toMatchObject({ claimed: false });
    await expect(
      runMailboxRecoveryBatch(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        {
          port: fake,
          tokenKey: TOKEN_KEY,
          tickId: "replacement",
          now: () => new Date("2026-09-03T13:05:01.000Z"),
        },
      ),
    ).resolves.toMatchObject({ claimed: true, completed: true });

    expect(
      addThreadToOpenRecovery(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        "enrolled-after-close",
        new Date("2026-09-03T13:05:02.000Z"),
      ),
    ).toBe("added");
    expect(
      value.client.sqlite
        .prepare(
          "select status from gmail_recovery_thread where gmail_thread_id = ?",
        )
        .get("enrolled-after-close"),
    ).toEqual({ status: "pending" });
  });

  it("drains every catch-up page and fetches a reply found after a clean first page", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "expired-cursor");
    let incremental = true;
    const gapPort = port({
      listHistory: async () => {
        if (incremental) {
          incremental = false;
          throw new GmailHistoryGapError();
        }
        return { historyId: "unused", threadIds: [], nextPageToken: null };
      },
      getProfileHistoryId: async () => "baseline",
    });
    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: gapPort,
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });
    const safetyBefore = new Date("2026-09-03T12:30:00.000Z");
    const pages: Array<{ historyId: string; threadIds: string[]; nextPageToken: string | null }> = [
      { historyId: "page-one", threadIds: [], nextPageToken: "page-2" },
      { historyId: "page-two", threadIds: ["reply-on-page-two"], nextPageToken: null },
      { historyId: "final-clean", threadIds: [], nextPageToken: null },
    ];
    const seenTokens: Array<string | null> = [];
    const recoveryPort = port({
      listHistory: async ({ pageToken }) => {
        seenTokens.push(pageToken);
        return pages.shift()!;
      },
    });

    const first = await runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: recoveryPort, tokenKey: TOKEN_KEY, tickId: "page-a", now: () => NOW },
    );
    expect(first.completed).toBe(false);
    const second = await runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: recoveryPort, tokenKey: TOKEN_KEY, tickId: "page-b", now: () => NOW },
    );
    expect(second.completed).toBe(false);
    expect(
      value.client.db.select().from(emailAccount).all().find((row) => row.id === value.accountA.id)!
        .sequenceSafeAt,
    ).toEqual(safetyBefore);
    const third = await runMailboxRecoveryBatch(
      value.client.db,
      value.tenantA,
      value.accountA.id,
      { port: recoveryPort, tokenKey: TOKEN_KEY, tickId: "page-c", now: () => NOW },
    );
    expect(third.completed).toBe(true);
    expect(seenTokens).toEqual([null, "page-2", null]);
    expect(
      value.client.sqlite
        .prepare("select count(*) as count from email_message where gmail_id = ?")
        .get("reply-on-page-two-message"),
    ).toEqual({ count: 1 });
  });

  it("backs off a failed recovery request without advancing its work item or safety stamp", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "expired-cursor");
    upsertEmailThread(value.client.db, value.tenantA, {
      accountId: value.accountA.id,
      gmailThreadId: "will-time-out",
      subject: "Old",
      lastMessageAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    const fake = port({
      listHistory: async () => { throw new GmailHistoryGapError(); },
      getProfileHistoryId: async () => "baseline",
      getThread: async () => { throw new Error("request timed out"); },
    });
    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: fake,
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });
    await expect(
      runMailboxRecoveryBatch(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        { port: fake, tokenKey: TOKEN_KEY, tickId: "failed", now: () => NOW },
      ),
    ).rejects.toThrow("request timed out");
    expect(
      value.client.sqlite
        .prepare("select status from gmail_recovery_thread where gmail_thread_id = ?")
        .get("will-time-out"),
    ).toEqual({ status: "pending" });
    expect(
      value.client.sqlite
        .prepare("select next_retry_at as retryAt, lease_owner as leaseOwner from gmail_recovery_generation where status != 'completed'")
        .get(),
    ).toEqual({ retryAt: NOW.valueOf() + 60_000, leaseOwner: null });
  });

  it("absorbs a thread during sweeping and defers one that arrives during catch-up", async () => {
    const value = fixture();
    seedCursor(value, value.accountA.id, "expired-cursor");
    upsertEmailThread(value.client.db, value.tenantA, {
      accountId: value.accountA.id,
      gmailThreadId: "existing",
      subject: "Old",
      lastMessageAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    await syncInboxAccount(value.client.db, value.tenantA, value.accountA.id, {
      port: port({
        listHistory: async () => { throw new GmailHistoryGapError(); },
        getProfileHistoryId: async () => "baseline",
      }),
      tokenKey: TOKEN_KEY,
      now: () => NOW,
    });
    expect(
      addThreadToOpenRecovery(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        "joined-while-sweeping",
        NOW,
      ),
    ).toBe("added");
    value.client.sqlite
      .prepare(
        "update gmail_recovery_generation set status = 'catching_up' where workspace_id = ? and account_id = ?",
      )
      .run(value.tenantA.workspaceId, value.accountA.id);
    expect(
      addThreadToOpenRecovery(
        value.client.db,
        value.tenantA,
        value.accountA.id,
        "deferred-after-catch-up",
        NOW,
      ),
    ).toBe("deferred");
    expect(
      value.client.sqlite
        .prepare("select count(*) as count from gmail_recovery_generation where workspace_id = ? and status != 'completed'")
        .get(value.tenantA.workspaceId),
    ).toEqual({ count: 2 });
    expect(
      value.client.sqlite
        .prepare("select count(*) as count from gmail_recovery_thread where gmail_thread_id in (?, ?)")
        .get("joined-while-sweeping", "deferred-after-catch-up"),
    ).toEqual({ count: 2 });
  });
});
