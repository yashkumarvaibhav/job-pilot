import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailAccount } from "../db/schema";
import { connectEmailAccount } from "../repos/email-accounts";
import { getEmailThread, upsertEmailThread } from "../repos/email-content";
import {
  GmailHistoryGapError,
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
});
