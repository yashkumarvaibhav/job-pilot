import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailMessage, sendQueue } from "../db/schema";
import type { MailSendRequest, QueueMailPort } from "../mail/mail-port";
import { createContact } from "../repos/contacts";
import { connectEmailAccount } from "../repos/email-accounts";
import { createQueueMessage, getQueueMessage } from "../repos/send-safety";
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

function port(
  lookup: Awaited<ReturnType<QueueMailPort["findByRfcMessageId"]>> = {
    status: "found",
    gmailMessageId: "gmail-message",
    gmailThreadId: "gmail-thread",
  },
) {
  return {
    send: vi.fn(async (request: MailSendRequest) => ({
      gmailMessageId: "gmail-message",
      gmailThreadId: "gmail-thread",
      rfcMessageId: request.rfcMessageId!,
      sentAt: NOW,
    })),
    findByRfcMessageId: vi.fn().mockResolvedValue(lookup),
  } satisfies QueueMailPort;
}

describe("send queue crash safety", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("recovers a process killed after Gmail accepts without sending twice", async () => {
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
    expect(mailPort.findByRfcMessageId).toHaveBeenCalledWith({
      refreshToken: "refresh-a",
      rfcMessageId: row.messageId,
    });
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "sent",
      gmailMessageId: "gmail-message",
    });
    expect(fixture.client.db.select().from(emailMessage).all()).toHaveLength(1);
  });

  it.each(["ambiguous", "failed"] as const)(
    "holds a stale claim when lookup is %s",
    async (outcome) => {
      const { fixture, row } = setup();
      cleanups.push(fixture.dispose);
      const mailPort = port({ status: "ambiguous" });
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
      ).rejects.toThrow();
      if (outcome === "failed") {
        mailPort.findByRfcMessageId.mockRejectedValueOnce(new Error("lookup failed"));
      }
      await reconcileClaimedRows(
        fixture.client.db,
        { mailPort, tokenKey: TOKEN_KEY },
        { now: new Date(NOW.valueOf() + 10 * 60_000), reclaimAfterMs: 1 },
      );
      expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
        status: "held",
      });
      expect(mailPort.send).toHaveBeenCalledOnce();
    },
  );

  it("returns a provably absent unchanged payload to approved", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    const mailPort = port({ status: "absent" });
    fixture.client.db
      .update(sendQueue)
      .set({ status: "claimed", claimedAt: NOW })
      .run();
    await reconcileClaimedRows(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: new Date(NOW.valueOf() + 10 * 60_000), reclaimAfterMs: 1 },
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "approved",
      approvalHash: row.payloadHash,
      claimedAt: null,
    });
  });

  it("holds a changed payload even when Gmail proves the old id absent", async () => {
    const { fixture, row } = setup();
    cleanups.push(fixture.dispose);
    const mailPort = port({ status: "absent" });
    fixture.client.sqlite
      .prepare("update send_queue set status = 'claimed', claimed_at = ?, body = 'changed' where id = ?")
      .run(NOW.valueOf(), row.id);
    await reconcileClaimedRows(
      fixture.client.db,
      { mailPort, tokenKey: TOKEN_KEY },
      { now: new Date(NOW.valueOf() + 10 * 60_000), reclaimAfterMs: 1 },
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, row.id)).toMatchObject({
      status: "held",
    });
    expect(mailPort.send).not.toHaveBeenCalled();
  });
});
