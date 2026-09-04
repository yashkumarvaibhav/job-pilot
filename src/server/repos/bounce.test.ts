import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  FIND_ANOTHER_CONTACT_TITLE,
  type BounceParseInput,
} from "../../domain/bounce";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import {
  bounceEvent,
  contactMethod,
  suppressionEntry,
} from "../db/schema";
import type { GmailThreadSnapshot } from "../mail/gmail-read-port";
import { createCompany } from "./companies";
import { applyBouncesFromSnapshot } from "./bounce";
import { createContact, getContact } from "./contacts";
import { createEmailTemplate } from "./email-content";
import { connectEmailAccount } from "./email-accounts";
import { ingestSyncedThreadSnapshot } from "./inbox-content";
import {
  SendSafetyError,
  createQueueMessage,
  getSuppressionBlock,
  removeSuppressionEntry,
} from "./send-safety";
import {
  createSequence,
  enrollSequence,
  listEnrollments,
} from "./sequences";
import { listTasks } from "./tasks";

const TOKEN_KEY = Buffer.alloc(32, 35).toString("base64");
const NOW = new Date("2026-09-04T10:00:00.000Z");
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../domain/bounce-fixtures",
);

function fixture(name: string): BounceParseInput {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as BounceParseInput;
}

function snapshotFromFixture(
  gmailId: string,
  input: BounceParseInput,
): GmailThreadSnapshot {
  return {
    gmailThreadId: `thread-${gmailId}`,
    historyId: "history-bounce",
    messages: [
      {
        gmailId,
        rfcMessageId: `<${gmailId}@invalid.test>`,
        fromEmail: input.fromEmail,
        to: ["sender-a@invalid.test"],
        subject: input.subject,
        body: input.body,
        deliveryStatusText: input.deliveryStatusText,
        failedRecipients: [...(input.failedRecipients ?? [])],
        sentAt: NOW,
      },
    ],
  };
}

describe("bounce application", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function setup() {
    const fixtureDb = createTenantTestFixture();
    cleanups.push(fixtureDb.dispose);
    const accountA = connectEmailAccount(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      {
        googleSub: "google-a",
        email: "sender-a@invalid.test",
        refreshToken: "refresh-a",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const accountASecond = connectEmailAccount(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      {
        googleSub: "google-a-second",
        email: "sender-b@invalid.test",
        refreshToken: "refresh-b",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const accountB = connectEmailAccount(
      fixtureDb.client.db,
      fixtureDb.tenantB,
      {
        googleSub: "google-b",
        email: "sender-b-ws@invalid.test",
        refreshToken: "refresh-c",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const companyA = createCompany(fixtureDb.client.db, fixtureDb.tenantA, {
      id: "company-amazon",
      name: "Amazon",
      now: NOW,
    });
    const priya = createContact(fixtureDb.client.db, fixtureDb.tenantA, {
      id: "contact-priya",
      name: "Priya Shah",
      companyId: companyA.id,
      methods: [{ kind: "email", value: "priya@invalid.test", isPrimary: true }],
      now: NOW,
    });
    createContact(fixtureDb.client.db, fixtureDb.tenantB, {
      id: "contact-priya-b",
      name: "Priya Other",
      methods: [{ kind: "email", value: "priya@invalid.test", isPrimary: true }],
      now: NOW,
    });
    return { fixtureDb, accountA, accountASecond, accountB, companyA, priya };
  }

  it("hard-bounces Priya, suppresses, cancels her sequence, and offers Find another contact", () => {
    const { fixtureDb, accountA, priya, companyA } = setup();
    const template = createEmailTemplate(fixtureDb.client.db, fixtureDb.tenantA, {
      id: "template-tiny",
      title: "Tiny follow-up",
      subject: "Hello",
      body: "Tiny template",
      now: NOW,
    });
    const sequence = createSequence(fixtureDb.client.db, fixtureDb.tenantA, {
      id: "seq-cold",
      name: "Cold email",
      steps: [{ offsetDays: 0, templateId: template.id }],
      now: NOW,
    });
    enrollSequence(fixtureDb.client.db, fixtureDb.tenantA, {
      id: "enroll-priya",
      sequenceId: sequence.id,
      contactId: priya.id,
      accountId: accountA.id,
      now: NOW,
    });

    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("bounce-priya", fixture("hard-550-mailbox-unavailable.json")),
      NOW,
    );

    expect(
      fixtureDb.client.db.select().from(suppressionEntry).all(),
    ).toEqual([
      expect.objectContaining({
        workspaceId: fixtureDb.tenantA.workspaceId,
        email: "priya@invalid.test",
        reason: "bounced",
        sourceKey: "bounce:priya@invalid.test",
      }),
    ]);
    expect(
      getSuppressionBlock(
        fixtureDb.client.db,
        fixtureDb.tenantA,
        "priya@invalid.test",
        priya.id,
      ),
    ).toMatchObject({
      reason: "bounced",
      message: "Email is blocked by bounced suppression.",
    });
    expect(listEnrollments(fixtureDb.client.db, fixtureDb.tenantA)).toEqual([
      expect.objectContaining({
        id: "enroll-priya",
        status: "cancelled",
        cancelReason: "bounce",
      }),
    ]);
    expect(listTasks(fixtureDb.client.db, fixtureDb.tenantA)).toEqual([
      expect.objectContaining({
        title: FIND_ANOTHER_CONTACT_TITLE,
        entityType: "company",
        entityId: companyA.id,
        source: "rule",
      }),
    ]);
    const methods = getContact(fixtureDb.client.db, fixtureDb.tenantA, priya.id)?.methods ?? [];
    expect(methods.find((method) => method.kind === "email")?.invalidAt).toEqual(NOW);
    expect(() =>
      createQueueMessage(fixtureDb.client.db, fixtureDb.tenantA, {
        accountId: accountA.id,
        contactId: priya.id,
        origin: "one_off",
        subject: "Hello again",
        body: "Should not send",
        attachmentVersionIds: [],
        sendAt: NOW,
        now: NOW,
      }),
    ).toThrow(SendSafetyError);

    const bounced = fixtureDb.client.db.select().from(suppressionEntry).all()[0]!;
    expect(removeSuppressionEntry(fixtureDb.client.db, fixtureDb.tenantA, bounced.id)).toEqual({
      removed: false,
      status: 409,
      error: "Bounced addresses cannot be un-suppressed.",
    });
    expect(fixtureDb.client.db.select().from(suppressionEntry).all()).toHaveLength(1);

    expect(
      getSuppressionBlock(
        fixtureDb.client.db,
        fixtureDb.tenantB,
        "priya@invalid.test",
        "contact-priya-b",
      ),
    ).toBeNull();
    expect(listEnrollments(fixtureDb.client.db, fixtureDb.tenantB)).toEqual([]);
  });

  it("does not let one account's bounce message count as another account's delivery result", () => {
    const { fixtureDb, accountA, accountASecond } = setup();
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("bounce-priya", fixture("hard-550-mailbox-unavailable.json")),
      NOW,
    );
    const events = fixtureDb.client.db.select().from(bounceEvent).all();
    expect(events).toEqual([
      expect.objectContaining({
        accountId: accountA.id,
        gmailMessageId: "bounce-priya",
        email: "priya@invalid.test",
        kind: "hard",
      }),
    ]);
    expect(events[0]?.accountId).not.toBe(accountASecond.id);
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountASecond.id,
      snapshotFromFixture("bounce-priya", fixture("hard-550-mailbox-unavailable.json")),
      NOW,
    );
    expect(fixtureDb.client.db.select().from(bounceEvent).all()).toEqual([
      expect.objectContaining({ accountId: accountA.id, gmailMessageId: "bounce-priya" }),
      expect.objectContaining({
        accountId: accountASecond.id,
        gmailMessageId: "bounce-priya",
      }),
    ]);
  });

  it("suppresses on the third soft bounce and ignores a replay of the same Gmail message", () => {
    const { fixtureDb, accountA } = setup();
    const soft = fixture("soft-452-mailbox-full.json");
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("soft-1", {
        ...soft,
        failedRecipients: ["priya@invalid.test"],
        deliveryStatusText: soft.deliveryStatusText?.replaceAll(
          "rahul@invalid.test",
          "priya@invalid.test",
        ),
      }),
      NOW,
    );
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("soft-2", {
        ...soft,
        failedRecipients: ["priya@invalid.test"],
        deliveryStatusText: soft.deliveryStatusText?.replaceAll(
          "rahul@invalid.test",
          "priya@invalid.test",
        ),
      }),
      NOW,
    );
    expect(fixtureDb.client.db.select().from(suppressionEntry).all()).toHaveLength(0);
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("soft-2", {
        ...soft,
        failedRecipients: ["priya@invalid.test"],
        deliveryStatusText: soft.deliveryStatusText?.replaceAll(
          "rahul@invalid.test",
          "priya@invalid.test",
        ),
      }),
      NOW,
    );
    expect(fixtureDb.client.db.select().from(bounceEvent).all()).toHaveLength(2);
    applyBouncesFromSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("soft-3", {
        ...soft,
        failedRecipients: ["priya@invalid.test"],
        deliveryStatusText: soft.deliveryStatusText?.replaceAll(
          "rahul@invalid.test",
          "priya@invalid.test",
        ),
      }),
      NOW,
    );
    expect(fixtureDb.client.db.select().from(suppressionEntry).all()).toEqual([
      expect.objectContaining({ email: "priya@invalid.test", reason: "bounced" }),
    ]);
  });

  it("applies an unmatched sync snapshot without storing a CRM thread", () => {
    const { fixtureDb, accountA } = setup();
    const stored = ingestSyncedThreadSnapshot(
      fixtureDb.client.db,
      fixtureDb.tenantA,
      accountA.id,
      snapshotFromFixture("bounce-priya", fixture("hard-550-mailbox-unavailable.json")),
      NOW,
    );
    expect(stored).toBeUndefined();
    expect(fixtureDb.client.db.select().from(suppressionEntry).all()).toEqual([
      expect.objectContaining({ email: "priya@invalid.test", reason: "bounced" }),
    ]);
    expect(
      fixtureDb.client.db.select().from(contactMethod).all().filter((row) => row.invalidAt),
    ).toHaveLength(1);
  });
});
