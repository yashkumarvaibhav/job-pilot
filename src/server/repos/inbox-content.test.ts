import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { connectEmailAccount, disconnectEmailAccount } from "./email-accounts";
import {
  classifyInboxReply,
  importGmailThread,
  ingestSyncedThreadSnapshot,
  listInboxThreads,
  relinkInboxThread,
  searchGmailThreads,
} from "./inbox-content";
import { countUnresolvedNeedReply } from "./interactions";
import { createReferral, getReferral } from "./referrals";
import type {
  GmailReadPort,
  GmailThreadSnapshot,
} from "../mail/gmail-read-port";

const TOKEN_KEY = Buffer.alloc(32, 15).toString("base64");
const NOW = new Date("2026-09-03T15:00:00.000Z");

function snapshot(
  gmailThreadId: string,
  fromEmail: string,
  body = "Thanks for reaching out.",
): GmailThreadSnapshot {
  return {
    gmailThreadId,
    historyId: "history-1",
    messages: [
      {
        gmailId: `${gmailThreadId}-message`,
        rfcMessageId: `<${gmailThreadId}@invalid.test>`,
        fromEmail,
        to: ["owner@invalid.test"],
        subject: `Subject ${gmailThreadId}`,
        body,
        sentAt: NOW,
      },
    ],
  };
}

function port(
  snapshots: Record<string, GmailThreadSnapshot>,
  calls: string[] = [],
): GmailReadPort {
  return {
    getProfileHistoryId: async () => "history-1",
    listHistory: async () => ({
      historyId: "history-1",
      threadIds: [],
      nextPageToken: null,
    }),
    listThreads: async ({ refreshToken, query, maxResults }) => {
      calls.push(`${refreshToken}:${query}:${maxResults}`);
      return { threadIds: Object.keys(snapshots), nextPageToken: null };
    },
    getThread: async ({ refreshToken, gmailThreadId }) => {
      calls.push(`${refreshToken}:${gmailThreadId}`);
      const value = snapshots[gmailThreadId];
      if (!value) throw new Error("missing fixture thread");
      return value;
    },
  };
}

describe("Job Inbox matching, import and classification", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function fixture() {
    const value = createTenantTestFixture();
    cleanups.push(value.dispose);
    const account = connectEmailAccount(
      value.client.db,
      value.tenantA,
      {
        googleSub: "google-owner",
        email: "owner@invalid.test",
        refreshToken: "refresh-owner",
        now: new Date("2026-09-03T14:00:00.000Z"),
      },
      TOKEN_KEY,
    );
    const foreignAccount = connectEmailAccount(
      value.client.db,
      value.tenantB,
      {
        googleSub: "google-foreign",
        email: "foreign@invalid.test",
        refreshToken: "refresh-foreign",
        now: new Date("2026-09-03T14:00:00.000Z"),
      },
      TOKEN_KEY,
    );
    return { ...value, account, foreignAccount };
  }

  it("automatically links one exact contact email and records the inbound reply once", () => {
    const value = fixture();
    const contact = createContact(value.client.db, value.tenantA, {
      id: "rahul",
      name: "Rahul",
      networkingStatus: "waiting_for_reply",
      methods: [{ kind: "email", value: "rahul@example.com", isPrimary: true }],
      now: NOW,
    });
    const referral = createReferral(value.client.db, value.tenantA, {
      id: "referral-rahul",
      contactId: contact.id,
      channel: "email",
      stage: "requested",
      requestedOn: "2026-09-01",
      now: NOW,
    })!;

    const first = ingestSyncedThreadSnapshot(
      value.client.db,
      value.tenantA,
      value.account.id,
      snapshot("thread-exact", "rahul@example.com"),
      NOW,
    );
    const repeated = ingestSyncedThreadSnapshot(
      value.client.db,
      value.tenantA,
      value.account.id,
      snapshot("thread-exact", "rahul@example.com"),
      NOW,
    )!;

    expect(first).toMatchObject({
      id: repeated.id,
      matchStatus: "automatic",
      matchReason: "Unique exact contact email",
      contactId: contact.id,
      referralId: referral.id,
    });
    expect(value.rowCount("email_message")).toBe(1);
    expect(value.rowCount("interaction")).toBe(1);
    expect(getReferral(value.client.db, value.tenantA, referral.id)?.stage).toBe(
      "seen_acknowledged",
    );
    expect(listInboxThreads(value.client.db, value.tenantB)).toEqual([]);
  });

  it("keeps multiple exact candidates and company-domain evidence as suggestions", () => {
    const value = fixture();
    const company = createCompany(value.client.db, value.tenantA, {
      id: "company-corp",
      name: "Corp",
      website: "https://corp.example",
      now: NOW,
    });
    const first = createContact(value.client.db, value.tenantA, {
      id: "first",
      companyId: company.id,
      name: "First",
      methods: [{ kind: "email", value: "first@corp.example" }],
      now: NOW,
    });
    const second = createContact(value.client.db, value.tenantA, {
      id: "second",
      companyId: company.id,
      name: "Second",
      methods: [{ kind: "email", value: "second@corp.example" }],
      now: NOW,
    });
    const multi = snapshot("thread-multi", "first@corp.example");
    multi.messages.push({
      ...multi.messages[0],
      gmailId: "thread-multi-second",
      fromEmail: "second@corp.example",
    });

    const ambiguous = ingestSyncedThreadSnapshot(
      value.client.db,
      value.tenantA,
      value.account.id,
      multi,
      NOW,
    )!;
    const domain = ingestSyncedThreadSnapshot(
      value.client.db,
      value.tenantA,
      value.account.id,
      snapshot("thread-domain", "unknown@corp.example"),
      NOW,
    )!;

    expect(ambiguous).toMatchObject({
      matchStatus: "suggested",
      matchReason: "Multiple exact contact emails",
      contactId: null,
    });
    expect(ambiguous.suggestedContactIdsJson).toEqual([first.id, second.id]);
    expect(domain).toMatchObject({
      matchStatus: "suggested",
      matchReason: "Company domain only",
      contactId: null,
    });
    expect(domain.suggestedContactIdsJson).toEqual([first.id, second.id]);
    expect(value.rowCount("interaction")).toBe(0);
  });

  it("searches and idempotently imports any selected owned-account thread as Unmatched", async () => {
    const value = fixture();
    const calls: string[] = [];
    const reader = port(
      { unknown: snapshot("unknown", "someone@unknown.example") },
      calls,
    );

    const results = await searchGmailThreads(
      value.client.db,
      value.tenantA,
      { accountId: value.account.id, query: "subject:interview" },
      { port: reader, tokenKey: TOKEN_KEY },
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ gmailThreadId: "unknown" });

    const first = await importGmailThread(
      value.client.db,
      value.tenantA,
      { accountId: value.account.id, gmailThreadId: "unknown" },
      { port: reader, tokenKey: TOKEN_KEY, now: () => NOW },
    );
    const repeated = await importGmailThread(
      value.client.db,
      value.tenantA,
      { accountId: value.account.id, gmailThreadId: "unknown" },
      { port: reader, tokenKey: TOKEN_KEY, now: () => NOW },
    );
    expect(first).toMatchObject({
      id: repeated.id,
      source: "manual_import",
      matchStatus: "unmatched",
      contactId: null,
    });
    expect(value.rowCount("email_thread")).toBe(1);
    expect(value.rowCount("email_message")).toBe(1);
    expect(calls[0]).toBe("refresh-owner:subject:interview:10");
  });

  it("rejects foreign and disconnected account imports before calling Gmail", async () => {
    const value = fixture();
    const calls: string[] = [];
    const reader = port({}, calls);
    await expect(
      searchGmailThreads(
        value.client.db,
        value.tenantA,
        { accountId: value.foreignAccount.id, query: "jobs" },
        { port: reader, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("Gmail account not found.");
    disconnectEmailAccount(value.client.db, value.tenantA, value.account.id, NOW);
    await expect(
      importGmailThread(
        value.client.db,
        value.tenantA,
        { accountId: value.account.id, gmailThreadId: "unknown" },
        { port: reader, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("Reconnect this Gmail account before importing.");
    expect(calls).toEqual([]);
    expect(value.rowCount("email_thread")).toBe(0);
  });

  it("relinks an unmatched thread, backfills its timeline, and classifies Need to respond", async () => {
    const value = fixture();
    const contact = createContact(value.client.db, value.tenantA, {
      id: "rahul",
      name: "Rahul",
      methods: [{ kind: "email", value: "rahul@example.com" }],
      now: NOW,
    });
    const reader = port({ unknown: snapshot("unknown", "unknown@example.com") });
    const imported = await importGmailThread(
      value.client.db,
      value.tenantA,
      { accountId: value.account.id, gmailThreadId: "unknown" },
      { port: reader, tokenKey: TOKEN_KEY, now: () => NOW },
    );
    expect(value.rowCount("interaction")).toBe(0);

    expect(
      relinkInboxThread(value.client.db, value.tenantB, imported.id, {
        contactId: contact.id,
      }),
    ).toBeUndefined();
    const linked = relinkInboxThread(value.client.db, value.tenantA, imported.id, {
      contactId: contact.id,
      now: NOW,
    });
    expect(linked).toMatchObject({
      contactId: contact.id,
      matchStatus: "manual",
      matchReason: "Linked manually",
    });
    expect(value.rowCount("interaction")).toBe(1);

    const classified = classifyInboxReply(
      value.client.db,
      value.tenantA,
      imported.id,
      "need_to_respond",
      NOW,
    );
    expect(classified?.classification).toBe("need_to_respond");
    expect(countUnresolvedNeedReply(value.client.db, value.tenantA)).toBe(1);
    expect(countUnresolvedNeedReply(value.client.db, value.tenantB)).toBe(0);
  });
});
