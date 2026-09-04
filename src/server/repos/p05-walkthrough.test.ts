import { readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { REVIEW_FOLLOW_UP_EMAIL, sequenceDueSourceKey } from "../../domain/sequence";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailAccount } from "../db/schema";
import { flushSendQueue } from "../jobs/send-queue";
import { runTick } from "../jobs/tick";
import type { MailPort, MailSendRequest } from "../mail/mail-port";
import { createContact } from "./contacts";
import { createEmailTemplate } from "./email-content";
import {
  connectEmailAccount,
  setDefaultEmailAccount,
} from "./email-accounts";
import { createInteraction } from "./interactions";
import {
  addSuppressionEntry,
  getQueueMessage,
  listQueueMessages,
  listSuppressionEntries,
  queueAccountUsage,
} from "./send-safety";
import {
  createSequence,
  enrollSequence,
  listEnrollments,
  listOutreachQueue,
  listSequences,
  saveSequenceReview,
  sequenceQueueRowId,
} from "./sequences";

const TOKEN_KEY = Buffer.alloc(32, 36).toString("base64");
const NOW = new Date("2026-09-04T10:00:00.000Z");

function mailPort() {
  return {
    send: vi.fn(async (request: MailSendRequest) => ({
      gmailMessageId: `gmail-${request.to[0]}`,
      gmailThreadId: `thread-${request.to[0]}`,
      rfcMessageId: request.rfcMessageId!,
      sentAt: NOW,
    })),
  } satisfies MailPort;
}

describe("P05 safe-sequence walkthrough", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("owns one queue approve route and no bulk-approve path", () => {
    const queueApi = join(process.cwd(), "src/app/api/queue");
    expect(readdirSync(queueApi)).toEqual(expect.arrayContaining(["[id]", "route.ts"]));
    expect(readdirSync(join(queueApi, "[id]"))).toEqual(
      expect.arrayContaining(["approve", "route.ts"]),
    );
    expect(readdirSync(join(queueApi, "[id]", "approve"))).toEqual(["route.ts"]);
    expect(readdirSync(queueApi).some((name) => /bulk|all/i.test(name))).toBe(false);
  });

  it("keeps three synthetic enrollments on the selected sender through limits, reply cancel and isolation", async () => {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
    const db = fixture.client.db;
    const a = fixture.tenantA;
    const b = fixture.tenantB;

    const personal = connectEmailAccount(
      db,
      a,
      {
        googleSub: "synthetic-personal",
        email: "personal@invalid.test",
        refreshToken: "synthetic-personal-refresh",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const career = connectEmailAccount(
      db,
      a,
      {
        googleSub: "synthetic-career",
        email: "career@invalid.test",
        refreshToken: "synthetic-career-refresh",
        dailyLimit: 2,
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    connectEmailAccount(
      db,
      b,
      {
        googleSub: "synthetic-foreign",
        email: "foreign@invalid.test",
        refreshToken: "synthetic-foreign-refresh",
        now: NOW,
      },
      TOKEN_KEY,
    );
    expect(setDefaultEmailAccount(db, a, personal.id, NOW)).toBe(true);

    const template = createEmailTemplate(db, a, {
      id: "template-tiny",
      title: "Tiny follow-up",
      subject: "Hello",
      body: "Tiny template",
      now: NOW,
    });
    const sequence = createSequence(db, a, {
      id: "seq-p05",
      name: "P05 safe sequence",
      steps: [
        { offsetDays: 0, templateId: template.id },
        { offsetDays: 4, templateId: template.id },
      ],
      now: NOW,
    });

    const contacts = [
      createContact(db, a, {
        id: "contact-ami",
        name: "Ami Shah",
        methods: [{ kind: "email", value: "ami@invalid.test", isPrimary: true }],
        now: NOW,
      }),
      createContact(db, a, {
        id: "contact-rahul",
        name: "Rahul Sharma",
        methods: [{ kind: "email", value: "rahul@invalid.test", isPrimary: true }],
        now: NOW,
      }),
      createContact(db, a, {
        id: "contact-priya",
        name: "Priya Shah",
        methods: [{ kind: "email", value: "priya@invalid.test", isPrimary: true }],
        now: NOW,
      }),
    ];
    const enrollments = contacts.map((contact, index) =>
      enrollSequence(db, a, {
        id: `enroll-${index}`,
        sequenceId: sequence.id,
        contactId: contact.id,
        accountId: career.id,
        now: NOW,
      }),
    );

    db.update(emailAccount)
      .set({
        sequenceSafeAt: new Date(NOW.valueOf() + 1000),
        lastSyncAt: new Date(NOW.valueOf() + 1000),
        updatedAt: new Date(NOW.valueOf() + 1000),
      })
      .where(
        and(eq(emailAccount.workspaceId, a.workspaceId), eq(emailAccount.id, career.id)),
      )
      .run();

    expect(setDefaultEmailAccount(db, a, career.id, NOW)).toBe(true);
    expect(setDefaultEmailAccount(db, a, personal.id, NOW)).toBe(true);

    const awaiting = listOutreachQueue(db, a, NOW);
    expect(awaiting).toHaveLength(3);
    expect(new Set(awaiting.map((row) => row.status))).toEqual(new Set(["awaiting_approval"]));
    expect(new Set(awaiting.map((row) => row.accountEmail))).toEqual(
      new Set(["career@invalid.test"]),
    );
    expect(new Set(awaiting.map((row) => row.accountId))).toEqual(new Set([career.id]));
    expect(awaiting.every((row) => row.subject === REVIEW_FOLLOW_UP_EMAIL)).toBe(true);
    expect(new Set(contacts.map((contact) => contact.methods[0]?.value))).toEqual(
      new Set(["ami@invalid.test", "rahul@invalid.test", "priya@invalid.test"]),
    );

    const port = mailPort();
    await runTick(db, { mailPort: port, tokenKey: TOKEN_KEY }, { now: NOW });
    await runTick(
      db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: new Date(NOW.valueOf() + 60_000) },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(listQueueMessages(db, a)).toHaveLength(0);

    for (const enrollment of enrollments) {
      expect(
        saveSequenceReview(
          db,
          a,
          sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
          { sendAt: NOW, approve: true, now: NOW },
        ),
      ).toMatchObject({
        status: "approved",
        accountId: career.id,
        recipient: expect.stringMatching(/@invalid\.test$/),
      });
    }

    await flushSendQueue(
      db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: NOW, maxSends: 100 },
    );
    expect(port.send).toHaveBeenCalledTimes(2);
    expect(port.send.mock.calls.every(([request]) => request.fromEmail === "career@invalid.test")).toBe(
      true,
    );
    expect(
      port.send.mock.calls.every(([request]) =>
        request.to.every((recipient) => recipient.endsWith("@invalid.test")),
      ),
    ).toBe(true);

    const afterLimit = listQueueMessages(db, a);
    expect(afterLimit.filter((row) => row.status === "sent")).toHaveLength(2);
    expect(afterLimit.filter((row) => row.status === "approved")).toHaveLength(1);
    expect(afterLimit.every((row) => row.accountId === career.id)).toBe(true);
    expect(
      queueAccountUsage(db, a, NOW).find((account) => account.id === career.id),
    ).toMatchObject({ sentToday: 2, dailyLimit: 2 });

    const sentEnrollment = listEnrollments(db, a).find(
      (row) => row.currentStepId !== enrollments.find((item) => item.id === row.id)?.currentStepId,
    );
    expect(sentEnrollment).toBeTruthy();
    const futureAt = new Date(NOW.valueOf() + 4 * 24 * 60 * 60 * 1000);
    db.update(emailAccount)
      .set({
        sequenceSafeAt: new Date(futureAt.valueOf() + 1000),
        lastSyncAt: new Date(futureAt.valueOf() + 1000),
        updatedAt: new Date(futureAt.valueOf() + 1000),
      })
      .where(
        and(eq(emailAccount.workspaceId, a.workspaceId), eq(emailAccount.id, career.id)),
      )
      .run();
    const futureReview = saveSequenceReview(
      db,
      a,
      sequenceDueSourceKey(sentEnrollment!.id, sentEnrollment!.currentStepId),
      { sendAt: futureAt, approve: true, now: NOW },
    );
    expect(futureReview).toMatchObject({ status: "approved", accountId: career.id });
    createInteraction(db, a, {
      contactId: sentEnrollment!.contactId,
      channel: "email",
      direction: "inbound",
      body: "Thanks — I will look this week.",
      occurredAt: new Date(futureAt.valueOf() - 1000),
      now: new Date(futureAt.valueOf() - 1000),
    });
    const replyPort = mailPort();
    await flushSendQueue(
      db,
      { mailPort: replyPort, tokenKey: TOKEN_KEY },
      {
        now: futureAt,
        onlyQueueId: sequenceQueueRowId(sentEnrollment!.id, sentEnrollment!.currentStepId),
      },
    );
    expect(replyPort.send).not.toHaveBeenCalled();
    expect(
      getQueueMessage(
        db,
        a,
        sequenceQueueRowId(sentEnrollment!.id, sentEnrollment!.currentStepId),
      ),
    ).toMatchObject({
      status: "cancelled",
      lastError: "Cancelled — reply received",
    });
    expect(
      listEnrollments(db, a).find((row) => row.id === sentEnrollment!.id),
    ).toMatchObject({ status: "cancelled", cancelReason: "reply" });

    const blocked = createContact(db, a, {
      id: "contact-blocked",
      name: "Blocked Contact",
      methods: [{ kind: "email", value: "blocked@invalid.test", isPrimary: true }],
      now: NOW,
    });
    addSuppressionEntry(db, a, {
      email: "blocked@invalid.test",
      reason: "bounced",
      now: NOW,
    });
    const blockedEnrollment = enrollSequence(db, a, {
      sequenceId: sequence.id,
      contactId: blocked.id,
      accountId: career.id,
      now: NOW,
    });
    expect(() =>
      saveSequenceReview(
        db,
        a,
        sequenceDueSourceKey(blockedEnrollment.id, blockedEnrollment.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/bounce/i);

    expect(listSequences(db, b)).toEqual([]);
    expect(listOutreachQueue(db, b, NOW)).toEqual([]);
    expect(listQueueMessages(db, b)).toEqual([]);
    expect(listEnrollments(db, b)).toEqual([]);
    expect(listSuppressionEntries(db, b)).toEqual([]);
    expect(queueAccountUsage(db, b, NOW).map((account) => account.email)).toEqual([
      "foreign@invalid.test",
    ]);
    expect(
      queueAccountUsage(db, b, NOW).every((account) => account.sentToday === 0),
    ).toBe(true);
  });
});
