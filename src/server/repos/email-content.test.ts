import { afterEach, describe, expect, it } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { connectEmailAccount, disconnectEmailAccount } from "./email-accounts";
import {
  EmailContentInputError,
  createEmailTemplate,
  getEmailThread,
  listEmailTemplates,
  recordEmailMessage,
  upsertEmailThread,
} from "./email-content";

const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

describe("email content repository", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
    const accountA = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a",
        email: "sender-a@invalid.test",
        refreshToken: "refresh-a",
        now: new Date("2026-09-03T12:00:00.000Z"),
      },
      TOKEN_KEY,
    );
    const accountASecond = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-a-second",
        email: "sender-a-second@invalid.test",
        refreshToken: "refresh-a-second",
        now: new Date("2026-09-03T12:01:00.000Z"),
      },
      TOKEN_KEY,
    );
    const accountB = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-b",
        email: "sender-b@invalid.test",
        refreshToken: "refresh-b",
        now: new Date("2026-09-03T12:02:00.000Z"),
      },
      TOKEN_KEY,
    );
    return { ...fixture, accountA, accountASecond, accountB };
  }

  it("stores owner-written templates with one explicit default account", () => {
    const fixture = newFixture();
    const created = createEmailTemplate(
      fixture.client.db,
      fixture.tenantA,
      {
        id: "template-referral",
        title: "Employee referral request",
        subject: "Hello {{first_name}}",
        body: "Could we discuss {{job_title}} at {{company}}?",
        variables: ["first_name", "job_title", "company"],
        defaultEmailAccountId: fixture.accountASecond.id,
        defaultFollowUpDays: 4,
        tags: ["Referral", "Warm"],
        now: new Date("2026-09-03T12:10:00.000Z"),
      },
    );

    expect(created).toMatchObject({
      id: "template-referral",
      workspaceId: fixture.tenantA.workspaceId,
      subject: "Hello {{first_name}}",
      variablesJson: ["first_name", "job_title", "company"],
      defaultEmailAccountId: fixture.accountASecond.id,
      defaultFollowUpDays: 4,
      tagsJson: ["Referral", "Warm"],
    });
    expect(listEmailTemplates(fixture.client.db, fixture.tenantA)).toEqual([
      created,
    ]);
    expect(listEmailTemplates(fixture.client.db, fixture.tenantB)).toEqual([]);
  });

  it("treats a foreign template account as missing without writing a row or event", () => {
    const fixture = newFixture();
    const beforeEvents = fixture.rowCount("activity_event");

    expect(() =>
      createEmailTemplate(fixture.client.db, fixture.tenantA, {
        title: "Foreign sender",
        subject: "Subject",
        body: "Body",
        defaultEmailAccountId: fixture.accountB.id,
      }),
    ).toThrowError(new EmailContentInputError("Gmail account not found."));
    expect(fixture.rowCount("email_template")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("keeps the same Gmail thread id separate for each connected account", () => {
    const fixture = newFixture();
    const first = upsertEmailThread(fixture.client.db, fixture.tenantA, {
      id: "thread-first",
      accountId: fixture.accountA.id,
      gmailThreadId: "gmail-thread-42",
      subject: "First mailbox copy",
      source: "manual_import",
      lastMessageAt: new Date("2026-09-03T13:00:00.000Z"),
    });
    const second = upsertEmailThread(fixture.client.db, fixture.tenantA, {
      id: "thread-second",
      accountId: fixture.accountASecond.id,
      gmailThreadId: "gmail-thread-42",
      subject: "Second mailbox copy",
      source: "manual_import",
      lastMessageAt: new Date("2026-09-03T13:01:00.000Z"),
    });

    expect(first.id).not.toBe(second.id);
    expect(fixture.rowCount("email_thread")).toBe(2);
  });

  it("records account-bound messages idempotently and returns them with the thread", () => {
    const fixture = newFixture();
    const thread = upsertEmailThread(fixture.client.db, fixture.tenantA, {
      id: "thread-a",
      accountId: fixture.accountA.id,
      gmailThreadId: "gmail-thread-a",
      subject: "Referral request",
      source: "sent",
      lastMessageAt: new Date("2026-09-03T14:00:00.000Z"),
    });
    const first = recordEmailMessage(fixture.client.db, fixture.tenantA, {
      id: "message-a",
      threadId: thread.id,
      accountId: fixture.accountA.id,
      gmailId: "gmail-message-a",
      rfcMessageId: "<message-a@invalid.test>",
      direction: "outbound",
      fromEmail: fixture.accountA.email,
      to: ["rahul@invalid.test"],
      subject: "Referral request",
      body: "Hello Rahul",
      sentAt: new Date("2026-09-03T14:00:00.000Z"),
    });
    const repeated = recordEmailMessage(fixture.client.db, fixture.tenantA, {
      id: "ignored-id",
      threadId: thread.id,
      accountId: fixture.accountA.id,
      gmailId: "gmail-message-a",
      direction: "outbound",
      fromEmail: fixture.accountA.email,
      to: ["rahul@invalid.test"],
      subject: "Ignored duplicate",
      body: "Ignored duplicate",
      sentAt: new Date("2026-09-03T14:01:00.000Z"),
    });

    expect(repeated).toEqual(first);
    expect(fixture.rowCount("email_message")).toBe(1);
    expect(getEmailThread(fixture.client.db, fixture.tenantA, thread.id)).toEqual({
      ...thread,
      messages: [first],
    });
    expect(
      getEmailThread(fixture.client.db, fixture.tenantB, thread.id),
    ).toBeUndefined();

    expect(
      disconnectEmailAccount(
        fixture.client.db,
        fixture.tenantA,
        fixture.accountA.id,
      ),
    ).toBe(true);
    expect(getEmailThread(fixture.client.db, fixture.tenantA, thread.id)).toEqual({
      ...thread,
      messages: [first],
    });
  });

  it("rejects a foreign thread and an account that does not own the thread", () => {
    const fixture = newFixture();
    const thread = upsertEmailThread(fixture.client.db, fixture.tenantA, {
      id: "thread-a",
      accountId: fixture.accountA.id,
      gmailThreadId: "gmail-thread-a",
      subject: "Account-bound",
      lastMessageAt: new Date("2026-09-03T14:00:00.000Z"),
    });
    const beforeEvents = fixture.rowCount("activity_event");
    const input = {
      threadId: thread.id,
      accountId: fixture.accountASecond.id,
      gmailId: "gmail-message-a",
      direction: "outbound" as const,
      fromEmail: fixture.accountASecond.email,
      to: ["rahul@invalid.test"],
      subject: "Wrong account",
      body: "Wrong account",
      sentAt: new Date("2026-09-03T14:00:00.000Z"),
    };

    expect(() =>
      recordEmailMessage(fixture.client.db, fixture.tenantA, input),
    ).toThrowError(new EmailContentInputError("Email thread not found."));
    expect(() =>
      recordEmailMessage(fixture.client.db, fixture.tenantB, {
        ...input,
        accountId: fixture.accountB.id,
      }),
    ).toThrowError(new EmailContentInputError("Email thread not found."));
    expect(fixture.rowCount("email_message")).toBe(0);
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });
});
