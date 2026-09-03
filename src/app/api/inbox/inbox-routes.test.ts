import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import { connectEmailAccount } from "../../../server/repos/email-accounts";
import { createContact } from "../../../server/repos/contacts";
import type {
  GmailReadPort,
  GmailThreadSnapshot,
} from "../../../server/mail/gmail-read-port";

const TOKEN_KEY = Buffer.alloc(32, 16).toString("base64");
const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  dependencies: null as unknown,
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/mail/runtime", () => ({
  getMailReadDependencies: () => mocks.dependencies,
}));

import { GET as listInbox } from "./route";
import { POST as searchInbox } from "./import/search/route";
import { POST as importInbox } from "./import/route";
import { POST as relinkInbox } from "./[id]/relink/route";
import { POST as classifyInbox } from "./[id]/classify/route";
import { POST as syncAccount } from "../gmail/[id]/sync/route";

const ORIGIN = "https://jobpilot.invalid.test";

function post(path: string, body: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function snapshot(): GmailThreadSnapshot {
  return {
    gmailThreadId: "gmail-thread",
    historyId: "history-2",
    messages: [
      {
        gmailId: "gmail-message",
        rfcMessageId: "<gmail-message@invalid.test>",
        fromEmail: "rahul@example.com",
        to: ["owner@invalid.test"],
        subject: "Re: Referral request",
        body: "Happy to help.",
        sentAt: new Date("2026-09-03T16:00:00.000Z"),
      },
    ],
  };
}

describe("Job Inbox routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    mocks.dependencies = null;
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
  });

  it("requires a Job Pilot session and fails closed without Gmail config", async () => {
    mocks.tenant = null;
    const context = { params: Promise.resolve({ id: "anything" }) };
    expect((await listInbox(new Request(`${ORIGIN}/api/inbox`))).status).toBe(401);
    expect((await searchInbox(post("/api/inbox/import/search", {}))).status).toBe(401);
    expect((await importInbox(post("/api/inbox/import", {}))).status).toBe(401);
    expect((await syncAccount(post("/sync", {}), context)).status).toBe(401);

    mocks.tenant = (fixtures[0] as ReturnType<typeof createTenantTestFixture>).tenantA;
    expect((await searchInbox(post("/api/inbox/import/search", {}))).status).toBe(503);
    expect((await importInbox(post("/api/inbox/import", {}))).status).toBe(503);
    expect((await syncAccount(post("/sync", {}), context)).status).toBe(503);
  });

  it("syncs, searches, imports, relinks and classifies one owned thread", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-owner",
        email: "owner@invalid.test",
        refreshToken: "refresh-owner",
      },
      TOKEN_KEY,
    );
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "rahul",
      name: "Rahul",
      methods: [{ kind: "email", value: "rahul@example.com" }],
    });
    const calls: string[] = [];
    const reader: GmailReadPort = {
      getProfileHistoryId: async () => "history-1",
      listHistory: async () => ({
        historyId: "history-2",
        threadIds: [],
        nextPageToken: null,
      }),
      listThreads: async ({ query }) => {
        calls.push(query);
        return { threadIds: ["gmail-thread"], nextPageToken: null };
      },
      getThread: async () => snapshot(),
    };
    mocks.dependencies = { port: reader, tokenKey: TOKEN_KEY };

    const synced = await syncAccount(post("/sync", {}), {
      params: Promise.resolve({ id: account.id }),
    });
    expect(synced.status).toBe(200);

    const searched = await searchInbox(
      post("/api/inbox/import/search", {
        accountId: account.id,
        query: "from:rahul@example.com",
      }),
    );
    expect(searched.status).toBe(200);
    await expect(searched.json()).resolves.toEqual(
      expect.objectContaining({ results: [expect.objectContaining({ gmailThreadId: "gmail-thread" })] }),
    );

    const imported = await importInbox(
      post("/api/inbox/import", {
        accountId: account.id,
        gmailThreadId: "gmail-thread",
      }),
    );
    expect(imported.status).toBe(201);
    const listed = await listInbox(new Request(`${ORIGIN}/api/inbox`));
    const listedBody = (await listed.json()) as { threads: { id: string }[] };
    expect(listedBody.threads).toHaveLength(1);
    const threadId = listedBody.threads[0].id;

    expect(
      (
        await relinkInbox(
          post(`/api/inbox/${threadId}/relink`, { contactId: contact.id }),
          { params: Promise.resolve({ id: threadId }) },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await classifyInbox(
          post(`/api/inbox/${threadId}/classify`, {
            classification: "need_to_respond",
          }),
          { params: Promise.resolve({ id: threadId }) },
        )
      ).status,
    ).toBe(200);
    expect(calls).toContain("from:rahul@example.com");
  });

  it("treats a foreign account as missing before the Gmail port is called", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const foreign = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-foreign",
        email: "foreign@invalid.test",
        refreshToken: "refresh-foreign",
      },
      TOKEN_KEY,
    );
    const called = vi.fn();
    mocks.dependencies = {
      tokenKey: TOKEN_KEY,
      port: {
        getProfileHistoryId: called,
        listHistory: called,
        listThreads: called,
        getThread: called,
      },
    };

    const response = await importInbox(
      post("/api/inbox/import", {
        accountId: foreign.id,
        gmailThreadId: "foreign-thread",
      }),
    );
    expect(response.status).toBe(404);
    expect(called).not.toHaveBeenCalled();
    expect(fixture.rowCount("email_thread")).toBe(0);
  });
});
