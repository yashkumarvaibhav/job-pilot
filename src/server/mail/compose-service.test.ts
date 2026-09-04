import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { createContact } from "../repos/contacts";
import { connectEmailAccount, disconnectEmailAccount } from "../repos/email-accounts";
import { listInteractions } from "../repos/interactions";
import type { MailPort, MailSendRequest, MailSendResult } from "./mail-port";
import { ComposeSendError, sendComposedEmail } from "./compose-service";

const TOKEN_KEY = Buffer.alloc(32, 11).toString("base64");

function fakePort(result: MailSendResult = {
  gmailMessageId: "gmail-message-1",
  gmailThreadId: "gmail-thread-1",
  rfcMessageId: "<message-1@jobpilot.invalid.test>",
  sentAt: new Date("2026-09-03T15:00:00.000Z"),
}) {
  return {
    send: vi.fn<(request: MailSendRequest) => Promise<typeof result>>()
      .mockResolvedValue(result),
  } satisfies MailPort;
}

describe("compose send service", () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function newFixture() {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
    return fixture;
  }

  function addAccount(
    fixture: ReturnType<typeof newFixture>,
    which: "tenantA" | "tenantB",
    suffix: string,
  ) {
    return connectEmailAccount(
      fixture.client.db,
      fixture[which],
      {
        googleSub: `google-${suffix}`,
        email: `sender-${suffix}@invalid.test`,
        refreshToken: `refresh-${suffix}`,
      },
      TOKEN_KEY,
    );
  }

  function addContact(
    fixture: ReturnType<typeof newFixture>,
    which: "tenantA" | "tenantB",
    suffix: string,
    networkingStatus?: "do_not_contact",
  ) {
    return createContact(fixture.client.db, fixture[which], {
      id: `contact-${suffix}`,
      name: `Contact ${suffix}`,
      networkingStatus,
      methods: [
        {
          kind: "email",
          value: `contact-${suffix}@invalid.test`,
          isPrimary: true,
        },
      ],
    });
  }

  it("refuses with a sentence when no connected account exists", async () => {
    const fixture = newFixture();
    const contact = addContact(fixture, "tenantA", "a");
    const port = fakePort();

    await expect(
      sendComposedEmail(
        fixture.client.db,
        fixture.tenantA,
        {
          accountId: "missing",
          contactId: contact.id,
          subject: "Hello",
          body: "Body",
          attachmentVersionIds: [],
          approval: "send_now",
        },
        { mailPort: port, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrowError(
      new ComposeSendError("Connect Gmail in Settings before sending email."),
    );
    expect(port.send).not.toHaveBeenCalled();
  });

  it("uses the explicitly selected account and records message, interaction, and EMAIL_SENT", async () => {
    const fixture = newFixture();
    addAccount(fixture, "tenantA", "first");
    const selected = addAccount(fixture, "tenantA", "selected");
    const contact = addContact(fixture, "tenantA", "a");
    const port = fakePort();

    const sent = await sendComposedEmail(
      fixture.client.db,
      fixture.tenantA,
      {
        accountId: selected.id,
        contactId: contact.id,
        subject: "Referral request",
        body: "Hello Contact a",
        attachmentVersionIds: [],
        approval: "send_now",
      },
      { mailPort: port, tokenKey: TOKEN_KEY },
    );

    expect(port.send).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: selected.id,
        fromEmail: selected.email,
        refreshToken: "refresh-selected",
        to: ["contact-a@invalid.test"],
        subject: "Referral request",
        body: "Hello Contact a",
      }),
    );
    expect(sent).toMatchObject({ accountId: selected.id, contactId: contact.id });
    expect(
      fixture.client.sqlite
        .prepare(
          "select account_id, gmail_id from email_message where workspace_id = ?",
        )
        .all(fixture.tenantA.workspaceId),
    ).toEqual([{ account_id: selected.id, gmail_id: "gmail-message-1" }]);
    expect(listInteractions(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({
        channel: "email",
        direction: "outbound",
        contactId: contact.id,
        emailMessageId: sent.messageId,
      }),
    ]);
    expect(
      fixture.client.sqlite
        .prepare(
          "select kind, json_extract(payload_json, '$.accountId') as account_id, json_extract(payload_json, '$.senderEmail') as sender_email from activity_event where kind = 'EMAIL_SENT'",
        )
        .all(),
    ).toEqual([
      {
        kind: "EMAIL_SENT",
        account_id: selected.id,
        sender_email: selected.email,
      },
    ]);
  });

  it("records Gmail's receipt without inventing a provider Message-ID", async () => {
    const fixture = newFixture();
    const account = addAccount(fixture, "tenantA", "a");
    const contact = addContact(fixture, "tenantA", "a");
    const port = fakePort({
      gmailMessageId: "gmail-message-1",
      gmailThreadId: "gmail-thread-1",
      rfcMessageId: null,
      sentAt: new Date("2026-09-03T15:00:00.000Z"),
    });

    await sendComposedEmail(
      fixture.client.db,
      fixture.tenantA,
      {
        accountId: account.id,
        contactId: contact.id,
        subject: "Hello",
        body: "Body",
        attachmentVersionIds: [],
        approval: "send_now",
      },
      { mailPort: port, tokenKey: TOKEN_KEY },
    );

    expect(
      fixture.client.sqlite
        .prepare("select rfc_message_id from email_message where gmail_id = ?")
        .get("gmail-message-1"),
    ).toEqual({ rfc_message_id: null });
  });

  it("does not fall back from a disconnected selected account", async () => {
    const fixture = newFixture();
    addAccount(fixture, "tenantA", "default");
    const disconnected = addAccount(fixture, "tenantA", "disconnected");
    disconnectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      disconnected.id,
    );
    const contact = addContact(fixture, "tenantA", "a");
    const port = fakePort();

    await expect(
      sendComposedEmail(
        fixture.client.db,
        fixture.tenantA,
        {
          accountId: disconnected.id,
          contactId: contact.id,
          subject: "Hello",
          body: "Body",
          attachmentVersionIds: [],
          approval: "send_now",
        },
        { mailPort: port, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("The selected Gmail account is disconnected. Reconnect it in Settings.");
    expect(port.send).not.toHaveBeenCalled();
  });

  it("treats foreign account and contact ids as missing without transport or events", async () => {
    const fixture = newFixture();
    const accountA = addAccount(fixture, "tenantA", "a");
    const accountB = addAccount(fixture, "tenantB", "b");
    const contactB = addContact(fixture, "tenantB", "b");
    const port = fakePort();
    const beforeEvents = fixture.rowCount("activity_event");
    const base = {
      contactId: contactB.id,
      subject: "Hello",
      body: "Body",
      attachmentVersionIds: [],
      approval: "send_now" as const,
    };

    await expect(
      sendComposedEmail(
        fixture.client.db,
        fixture.tenantA,
        { ...base, accountId: accountB.id },
        { mailPort: port, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("Gmail account not found.");
    await expect(
      sendComposedEmail(
        fixture.client.db,
        fixture.tenantA,
        { ...base, accountId: accountA.id },
        { mailPort: port, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("Contact not found.");
    expect(port.send).not.toHaveBeenCalled();
    expect(fixture.rowCount("activity_event")).toBe(beforeEvents);
  });

  it("hard-blocks Do Not Contact without an override", async () => {
    const fixture = newFixture();
    const account = addAccount(fixture, "tenantA", "a");
    const contact = addContact(fixture, "tenantA", "blocked", "do_not_contact");
    const port = fakePort();

    await expect(
      sendComposedEmail(
        fixture.client.db,
        fixture.tenantA,
        {
          accountId: account.id,
          contactId: contact.id,
          subject: "Hello",
          body: "Body",
          attachmentVersionIds: [],
          approval: "send_now",
        },
        { mailPort: port, tokenKey: TOKEN_KEY },
      ),
    ).rejects.toThrow("This contact is marked Do Not Contact. Email is blocked.");
    expect(port.send).not.toHaveBeenCalled();
  });
});
