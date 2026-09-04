import { afterEach, describe, expect, it } from "vitest";

import {
  UNCERTAIN_DELIVERY_ERROR,
  hashSendPayload,
} from "../../domain/send-safety";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { sendQueue, suppressionEntry } from "../db/schema";
import { connectEmailAccount } from "./email-accounts";
import { createContact, updateContact } from "./contacts";
import {
  SendSafetyError,
  addSuppressionEntry,
  approveQueueMessage,
  createQueueMessage,
  getQueueMessage,
  listQueueMessages,
  removeManualSuppression,
  updateQueueMessage,
} from "./send-safety";

const TOKEN_KEY = Buffer.alloc(32, 17).toString("base64");
const NOW = new Date("2026-09-03T19:00:00.000Z");

function setup() {
  const fixture = createTenantTestFixture();
  const accountA = connectEmailAccount(
    fixture.client.db,
    fixture.tenantA,
    {
      googleSub: "google-a",
      email: "sender-a@invalid.test",
      refreshToken: "refresh-a",
      now: NOW,
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
      now: NOW,
    },
    TOKEN_KEY,
  );
  const contactA = createContact(fixture.client.db, fixture.tenantA, {
    id: "contact-a",
    name: "Contact A",
    methods: [
      { kind: "email", value: "recipient@invalid.test", isPrimary: true },
    ],
    now: NOW,
  });
  return { fixture, accountA, accountB, contactA };
}

describe("send safety repository", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("creates one immutable approved row with a deterministic Message-ID", () => {
    const { fixture, accountA, contactA } = setup();
    cleanups.push(fixture.dispose);
    const sendAt = new Date("2026-09-04T03:30:00.000Z");
    const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-a",
      accountId: accountA.id,
      contactId: contactA.id,
      origin: "one_off",
      subject: "Subject",
      body: "Complete body",
      attachmentVersionIds: ["version-b", "version-a"],
      sendAt,
      approvalKind: "owner_click",
      now: NOW,
    });

    expect(row).toMatchObject({
      status: "approved",
      recipient: "recipient@invalid.test",
      approvalKind: "owner_click",
      messageId: "<jp-queue-a@invalid.test>",
    });
    expect(row.payloadHash).toBe(row.approvalHash);
    expect(row.payloadHash).toBe(
      hashSendPayload({
        recipient: row.recipient,
        accountId: accountA.id,
        subject: "Subject",
        body: "Complete body",
        attachmentVersionIds: ["version-b", "version-a"],
        sendAt,
      }),
    );
  });

  it("keeps queue ids, accounts and rows inside their workspace", () => {
    const { fixture, accountA, accountB, contactA } = setup();
    cleanups.push(fixture.dispose);
    const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-a",
      accountId: accountA.id,
      contactId: contactA.id,
      origin: "one_off",
      subject: "Subject",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      now: NOW,
    });
    expect(getQueueMessage(fixture.client.db, fixture.tenantB, row.id)).toBeUndefined();
    expect(listQueueMessages(fixture.client.db, fixture.tenantB)).toEqual([]);
    expect(() =>
      createQueueMessage(fixture.client.db, fixture.tenantA, {
        accountId: accountB.id,
        contactId: contactA.id,
        origin: "one_off",
        subject: "Subject",
        body: "Body",
        attachmentVersionIds: [],
        sendAt: NOW,
      }),
    ).toThrowError("Gmail account not found.");
  });

  it("clears approval after any approval-bound edit and can reapprove one id", () => {
    const { fixture, accountA, contactA } = setup();
    cleanups.push(fixture.dispose);
    const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-edit",
      accountId: accountA.id,
      contactId: contactA.id,
      origin: "one_off",
      subject: "Subject",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      approvalKind: "owner_click",
      now: NOW,
    });

    const edited = updateQueueMessage(
      fixture.client.db,
      fixture.tenantA,
      row.id,
      { body: "Body changed by one byte" },
      new Date(NOW.valueOf() + 1_000),
    );
    expect(edited).toMatchObject({
      status: "awaiting_approval",
      approvalHash: null,
      approvalKind: null,
      approvedAt: null,
    });
    const reapproved = approveQueueMessage(
      fixture.client.db,
      fixture.tenantA,
      row.id,
      { sendAt: new Date(NOW.valueOf() + 120_000), now: new Date(NOW.valueOf() + 2_000) },
    );
    expect(reapproved).toMatchObject({ status: "approved", approvalKind: "owner_click" });
    expect(reapproved?.payloadHash).toBe(reapproved?.approvalHash);
  });

  it("requires a check-Sent acknowledgement before reapproving uncertain delivery", () => {
    const { fixture, accountA, contactA } = setup();
    cleanups.push(fixture.dispose);
    const row = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-uncertain",
      accountId: accountA.id,
      contactId: contactA.id,
      origin: "one_off",
      subject: "Subject",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      now: NOW,
    });
    fixture.client.db
      .update(sendQueue)
      .set({ status: "held", lastError: UNCERTAIN_DELIVERY_ERROR })
      .run();

    expect(() =>
      approveQueueMessage(fixture.client.db, fixture.tenantA, row.id),
    ).toThrowError("Check Gmail Sent before approving a new attempt.");
    expect(
      approveQueueMessage(fixture.client.db, fixture.tenantA, row.id, {
        uncertainDeliveryAcknowledged: true,
      }),
    ).toMatchObject({ status: "approved", lastError: null });
  });

  it("blocks every queue creation for a suppressed address without an override", () => {
    const { fixture, accountA, contactA } = setup();
    cleanups.push(fixture.dispose);
    const manual = addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "recipient@invalid.test",
      reason: "manual",
      now: NOW,
    });
    expect(() =>
      createQueueMessage(fixture.client.db, fixture.tenantA, {
        accountId: accountA.id,
        contactId: contactA.id,
        origin: "one_off",
        subject: "Subject",
        body: "Body",
        attachmentVersionIds: [],
        sendAt: NOW,
      }),
    ).toThrowError(SendSafetyError);
    expect(removeManualSuppression(fixture.client.db, fixture.tenantA, manual.id)).toBe(true);
    expect(fixture.client.db.select().from(suppressionEntry).all()).toHaveLength(0);
  });

  it("never removes bounce suppression through the manual removal path", () => {
    const { fixture } = setup();
    cleanups.push(fixture.dispose);
    const bounced = addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "recipient@invalid.test",
      reason: "bounced",
      sourceKey: "gmail:bounce-1",
      now: NOW,
    });
    expect(removeManualSuppression(fixture.client.db, fixture.tenantA, bounced.id)).toBe(false);
    expect(fixture.client.db.select().from(suppressionEntry).all()).toHaveLength(1);
    expect(fixture.client.db.select().from(sendQueue).all()).toHaveLength(0);
  });

  it("suppresses new Do Not Contact methods and cancels already queued mail atomically", () => {
    const { fixture, accountA, contactA } = setup();
    cleanups.push(fixture.dispose);
    const queued = createQueueMessage(fixture.client.db, fixture.tenantA, {
      id: "queue-dnc",
      accountId: accountA.id,
      contactId: contactA.id,
      origin: "one_off",
      subject: "Subject",
      body: "Body",
      attachmentVersionIds: [],
      sendAt: NOW,
      approvalKind: "owner_click",
      now: NOW,
    });
    updateContact(
      fixture.client.db,
      fixture.tenantA,
      contactA.id,
      {
        networkingStatus: "do_not_contact",
        methods: [{ kind: "email", value: "new-recipient@invalid.test" }],
      },
      new Date(NOW.valueOf() + 1_000),
    );
    expect(getQueueMessage(fixture.client.db, fixture.tenantA, queued.id)).toMatchObject({
      status: "cancelled",
      approvalHash: null,
    });
    expect(fixture.client.db.select().from(suppressionEntry).all()).toEqual([
      expect.objectContaining({
        email: "new-recipient@invalid.test",
        reason: "do_not_contact",
        sourceKey: `contact:${contactA.id}`,
      }),
    ]);
  });

  it("leaving Do Not Contact removes only that contact source", () => {
    const { fixture, contactA } = setup();
    cleanups.push(fixture.dispose);
    updateContact(fixture.client.db, fixture.tenantA, contactA.id, {
      networkingStatus: "do_not_contact",
    });
    addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "recipient@invalid.test",
      reason: "bounced",
      sourceKey: "gmail:bounce-1",
      now: NOW,
    });
    updateContact(fixture.client.db, fixture.tenantA, contactA.id, {
      networkingStatus: "keep_in_touch",
      overrideDoNotContact: true,
    });
    expect(
      fixture.client.db
        .select({ reason: suppressionEntry.reason, sourceKey: suppressionEntry.sourceKey })
        .from(suppressionEntry)
        .all(),
    ).toEqual([{ reason: "bounced", sourceKey: "gmail:bounce-1" }]);
  });
});
