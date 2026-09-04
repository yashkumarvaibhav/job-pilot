import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailAccount, emailMessage, sendQueue } from "../db/schema";
import type { MailPort, MailSendRequest } from "../mail/mail-port";
import { createContact } from "../repos/contacts";
import { connectEmailAccount } from "../repos/email-accounts";
import {
  approveQueueMessage,
  createQueueMessage,
  getQueueMessage,
} from "../repos/send-safety";
import { flushSendQueue, reconcileClaimedRows } from "./send-queue";

const TOKEN_KEY = Buffer.alloc(32, 19).toString("base64");
const NOW = new Date("2026-09-03T10:00:00.000Z");

function setup() {
  const fixture = createTenantTestFixture();
  const account = connectEmailAccount(
    fixture.client.db,
    fixture.tenantA,
    {
      googleSub: "google-a",
      email: "sender@invalid.test",
      refreshToken: "refresh-a",
      sendingWindowStart: 0,
      sendingWindowEnd: 1439,
      now: NOW,
    },
    TOKEN_KEY,
  );
  const contact = createContact(fixture.client.db, fixture.tenantA, {
    id: "contact-a",
    name: "Contact A",
    methods: [
      { kind: "email", value: "recipient@invalid.test", isPrimary: true },
    ],
    now: NOW,
  });
  const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
    id: "queue-a",
    accountId: account.id,
    contactId: contact.id,
    origin: "one_off",
    subject: "Subject",
    body: "Body",
    attachmentVersionIds: [],
    sendAt: NOW,
    approvalKind: "owner_click",
    now: NOW,
  });
  return { fixture, account, contact, row };
}

function port() {
  return {
    send: vi.fn(async (request: MailSendRequest) => ({
      gmailMessageId: "gmail-message",
      gmailThreadId: "gmail-thread",
      rfcMessageId: request.rfcMessageId!,
      sentAt: NOW,
    })),
  } satisfies MailPort;
}

describe("send queue crash safety", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("holds a process killed after Gmail accepts without sending twice", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    const mailPort = port();
    await expect(
      flushSendQueue(
        fixture.client.db,
        { mailPort, tokenKey: TOKEN_KEY },
        {
          now: NOW,
          afterTransportAccepted: () => {
            throw new Error("simulated process death");
          },
        },
      ),
    ).rejects.toThrow("simulated process death");
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "claimed",
      gmailMessageId: null,
    });

    const later = new Date(NOW.valueOf() + 10 * 60_000);
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: later, reclaimAfterMs: 5 * 60_000 },
    );
    expect(mailPort.send).toHaveBeenCalledOnce();
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "held",
      approvalHash: null,
      lastError: expect.stringContaining("Check Gmail Sent"),
      gmailMessageId: null,
    });
    expect(fixture.client.db.select().from(emailMessage).all()).toHaveLength(0);
  });

  it("never restores an unchanged stale claim to approved", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    fixture.client.db
      .update(sendQueue)
      .set({ status: "claimed", claimedAt: NOW })
      .run();
    await reconcileClaimedRows(
      fixture.client.db,
      { now: new Date(NOW.valueOf() + 10 * 60_000), reclaimAfterMs: 1 },
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "held",
      approvalHash: null,
      lastError: expect.stringContaining("will not retry automatically"),
    });
  });

  it("holds a changed stale claim without calling Gmail", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    fixture.client.sqlite
      .prepare("update send_queue set status = 'claimed', claimed_at = ?, body = 'changed' where id = ?")
      .run(NOW.valueOf(), row.id);
    await reconcileClaimedRows(
      fixture.client.db,
      { now: new Date(NOW.valueOf() + 10 * 60_000), reclaimAfterMs: 1 },
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "held",
    });
  });

  it("never claims an unapproved or hash-mismatched row", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    const mailPort = port();
    fixture.client.db
      .update(sendQueue)
      .set({
        status: "approved",
        approvalHash: null,
        approvedAt: NOW,
        approvalKind: "owner_click",
      })
      .run();
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: NOW },
    );
    expect(mailPort.send).not.toHaveBeenCalled();
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "awaiting_approval",
      approvalHash: null,
    });
  });

  it("reserves 40 daily slots transactionally and leaves the 41st approved", async () => {
    const { fixture, account, contact } = setup();
    cleanups.push(fixture.dispose);
    fixture.client.db
      .update(emailAccount)
      .set({ dailyLimit: 40 })
      .where(eq(emailAccount.id, account.id))
      .run();
    for (let index = 2; index <= 41; index += 1) {
      const id = `queue-${String(index).padStart(2, "0")}`;
      createQueueMessage(fixture.client.db, fixture.tenantA, {
        id,
        accountId: account.id,
        contactId: contact.id,
        origin: "one_off",
        subject: id,
        body: "Body",
        attachmentVersionIds: [],
        sendAt: NOW,
        approvalKind: "owner_click",
        now: NOW,
      });
    }
    let sequence = 0;
    const mailPort: MailPort = {
      send: vi.fn(async (request) => {
        sequence += 1;
        return {
          gmailMessageId: `gmail-${sequence}`,
          gmailThreadId: `thread-${sequence}`,
          rfcMessageId: request.rfcMessageId!,
          sentAt: NOW,
        };
      }),
    };
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: NOW, maxSends: 100 },
    );
    expect(mailPort.send).toHaveBeenCalledTimes(40);
    expect(
      fixture.client.db
        .select({ status: sendQueue.status })
        .from(sendQueue)
        .all()
        .map(({ status }) => status)
        .sort(),
    ).toEqual(["approved", ...Array.from({ length: 40 }, () => "sent")]);
  });

  it("defers approved rows outside the account's saved-zone weekday window", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    const mailPort = port();
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: new Date("2026-09-06T10:00:00.000Z") },
    );
    expect(mailPort.send).not.toHaveBeenCalled();
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)?.status).toBe(
      "approved",
    );
  });

  it("lets overlapping flushes claim each row once", async () => {
    const { fixture, account, contact } = setup();
    cleanups.push(fixture.dispose);
    createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-b",
      accountId: account.id,
      contactId: contact.id,
      origin: "one_off",
      subject: "Second",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      approvalKind: "owner_click",
      now: NOW,
    });
    const sentIds: string[] = [];
    const mailPort: MailPort = {
      send: vi.fn(async (request) => {
        sentIds.push(request.rfcMessageId!);
        await Promise.resolve();
        return {
          gmailMessageId: `gmail-${request.rfcMessageId}`,
          gmailThreadId: `thread-${request.rfcMessageId}`,
          rfcMessageId: request.rfcMessageId!,
          sentAt: NOW,
        };
      }),
    };
    await Promise.all([
      flushSendQueue(
        fixture.client.db,
        { mailPort, tokenKey: TOKEN_KEY },
        { now: NOW, maxSends: 1 },
      ),
      flushSendQueue(
        fixture.client.db,
        { mailPort, tokenKey: TOKEN_KEY },
        { now: NOW, maxSends: 1 },
      ),
    ]);
    expect(sentIds).toHaveLength(2);
    expect(new Set(sentIds).size).toBe(2);
  });

  it("uses each workspace account, token and timezone independently", async () => {
    const { fixture } = setup();
    cleanups.push(fixture.dispose);
    const accountB = connectEmailAccount(
      fixture.client.db,
      fixture.tenantB,
      {
        googleSub: "google-b",
        email: "sender-b@invalid.test",
        refreshToken: "refresh-b",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const contactB = createContact(fixture.client.db, fixture.tenantB, {
      id: "contact-b",
      name: "Contact B",
      methods: [{ kind: "email", value: "recipient-b@invalid.test" }],
      now: NOW,
    });
    createQueueMessage(fixture.client.db, fixture.tenantB, {
      id: "queue-tenant-b",
      accountId: accountB.id,
      contactId: contactB.id,
      origin: "one_off",
      subject: "Tenant B",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      approvalKind: "owner_click",
      now: NOW,
    });
    const requests: MailSendRequest[] = [];
    const mailPort: MailPort = {
      send: vi.fn(async (request) => {
        requests.push(request);
        return {
          gmailMessageId: `gmail-${request.accountId}`,
          gmailThreadId: `thread-${request.accountId}`,
          rfcMessageId: request.rfcMessageId!,
          sentAt: NOW,
        };
      }),
    };
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: NOW, maxSends: 10 },
    );
    expect(requests.map(({ fromEmail, refreshToken }) => [fromEmail, refreshToken])).toEqual([
      ["sender@invalid.test", "refresh-a"],
      ["sender-b@invalid.test", "refresh-b"],
    ]);
  });

  it("sends an approved sequence without the disproved Message-ID gate", async () => {
    const { fixture, account, contact } = setup();
    cleanups.push(fixture.dispose);
    const sequence = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-sequence",
      accountId: account.id,
      contactId: contact.id,
      origin: "sequence",
      subject: "Sequence step",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      now: NOW,
    });
    fixture.client.db
      .update(emailAccount)
      .set({ sequenceSafeAt: NOW, lastSyncAt: NOW })
      .where(eq(emailAccount.id, account.id))
      .run();
    approveQueueMessage(fixture.client.db, fixture.tenantA, sequence.id, {
      now: NOW,
    });
    const mailPort = port();
    await flushSendQueue(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: NOW, onlyQueueId: sequence.id },
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, sequence.id)).toMatchObject({
      status: "sent",
      gmailMessageId: "gmail-message",
    });
    expect(mailPort.send).toHaveBeenCalledOnce();
  });
});
