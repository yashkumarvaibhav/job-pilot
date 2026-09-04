import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

import { HELD_MAILBOX_UNPROVEN, REVIEW_FOLLOW_UP_EMAIL, sequenceDueSourceKey } from "../../domain/sequence";
import { createTenantTestFixture } from "../../test/tenant-fixture";
import { emailAccount } from "../db/schema";
import { flushSendQueue } from "../jobs/send-queue";
import { runTick } from "../jobs/tick";
import type { GmailReadPort } from "../mail/gmail-read-port";
import type { MailPort, MailSendRequest } from "../mail/mail-port";
import { createCompany } from "./companies";
import { createContact, updateContact } from "./contacts";
import { createEmailTemplate } from "./email-content";
import { connectEmailAccount } from "./email-accounts";
import { createInteraction } from "./interactions";
import { createOpportunity, updateOpportunity } from "./opportunities";
import { applyToOpportunity, updateApplication } from "./applications";
import { createReferral } from "./referrals";
import {
  getQueueMessage,
  listQueueMessages,
  addSuppressionEntry,
} from "./send-safety";
import {
  SequenceError,
  createSequence,
  enrollSequence,
  listEnrollments,
  saveSequenceReview,
  sequenceQueueRowId,
  stopEnrollment,
} from "./sequences";
import { getTodaySnapshot } from "./today";

const TOKEN_KEY = Buffer.alloc(32, 34).toString("base64");
const NOW = new Date("2026-09-04T10:00:00.000Z");

function mailPort() {
  return {
    send: vi.fn(async (request: MailSendRequest) => ({
      gmailMessageId: "gmail-message",
      gmailThreadId: "gmail-thread",
      rfcMessageId: request.rfcMessageId!,
      sentAt: NOW,
    })),
  } satisfies MailPort;
}

function failingReadPort(): GmailReadPort {
  const fail = async () => {
    throw new Error("sync unavailable");
  };
  return {
    getProfileHistoryId: fail,
    listHistory: fail,
    listThreads: fail,
    getThread: fail,
  };
}

describe("approval-gated sequences", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function setup() {
    const fixture = createTenantTestFixture();
    cleanups.push(fixture.dispose);
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
    const otherAccount = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "google-b",
        email: "other@invalid.test",
        refreshToken: "refresh-b",
        sendingWindowStart: 0,
        sendingWindowEnd: 1439,
        now: NOW,
      },
      TOKEN_KEY,
    );
    const template = createEmailTemplate(fixture.client.db, fixture.tenantA, {
      id: "template-tiny",
      title: "Tiny follow-up",
      subject: "Hello",
      body: "Tiny template",
      now: NOW,
    });
    const contact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-priya",
      name: "Priya Shah",
      methods: [{ kind: "email", value: "priya@invalid.test", isPrimary: true }],
      now: NOW,
    });
    const sequence = createSequence(fixture.client.db, fixture.tenantA, {
      id: "seq-cold",
      name: "Cold email",
      steps: [
        { offsetDays: 0, templateId: template.id },
        { offsetDays: 4, templateId: template.id },
      ],
      now: NOW,
    });
    return { fixture, account, otherAccount, template, contact, sequence };
  }

  function stampSafe(
    fixture: ReturnType<typeof createTenantTestFixture>,
    accountId: string,
    at: Date,
  ) {
    fixture.client.db
      .update(emailAccount)
      .set({ sequenceSafeAt: at, lastSyncAt: at, updatedAt: at })
      .where(
        and(
          eq(emailAccount.workspaceId, fixture.tenantA.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .run();
  }

  it("derives a review item and sends nothing until the exact due row is approved", async () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      id: "enroll-a",
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 1000));
    const today = getTodaySnapshot(fixture.client.db, fixture.tenantA, { now: NOW });
    expect(today.doNow.map((item) => item.title)).toContain(REVIEW_FOLLOW_UP_EMAIL);
    const port = mailPort();
    await runTick(fixture.client.db, { mailPort: port, tokenKey: TOKEN_KEY }, { now: NOW });
    await runTick(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: new Date(NOW.valueOf() + 60_000) },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)).toHaveLength(0);

    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: true, now: NOW },
    );
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: NOW },
    );
    expect(port.send).toHaveBeenCalledOnce();
    expect(listEnrollments(fixture.client.db, fixture.tenantA)[0]?.currentStepId).not.toBe(
      enrollment.currentStepId,
    );
  });

  it("requires a separate approval for the next offset", async () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 1000));
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: true, now: NOW },
    );
    await flushSendQueue(
      fixture.client.db,
      { mailPort: mailPort(), tokenKey: TOKEN_KEY },
      { now: NOW },
    );
    const advanced = listEnrollments(fixture.client.db, fixture.tenantA)[0]!;
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)[0]?.status).toBe("sent");
    expect(advanced.currentStepId).not.toBe(enrollment.currentStepId);
    const day4 = new Date(NOW.valueOf() + 4 * 24 * 60 * 60 * 1000);
    stampSafe(fixture, account.id, new Date(day4.valueOf() + 1000));
    const port = mailPort();
    await runTick(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: day4 },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
        { sendAt: day4, approve: true, now: day4, requestKeys: ["sendAnyway"] },
      ),
    ).toThrow(/cannot skip the mailbox freshness check/);
    const saved = saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(advanced.id, advanced.currentStepId),
      { sendAt: day4, approve: true, now: day4 },
    );
    expect(saved).toMatchObject({ status: "approved" });
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: day4 },
    );
    expect(port.send).toHaveBeenCalledOnce();
    expect(listQueueMessages(fixture.client.db, fixture.tenantA).map((row) => row.status)).toEqual(
      expect.arrayContaining(["sent", "sent"]),
    );
  });

  it("cancels on bounce, a rejected application and a received referral", async () => {
    const { fixture, account, contact, sequence, template } = setup();
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 1000));

    const bounced = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    addSuppressionEntry(fixture.client.db, fixture.tenantA, {
      email: "priya@invalid.test",
      reason: "bounced",
      now: NOW,
    });
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(bounced.id, bounced.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/bounce/i);

    const company = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Reject Co",
      now: NOW,
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      companyId: company.id,
      role: "SDE",
      now: NOW,
    });
    const rejectedContact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-reject",
      name: "Rejected Applicant",
      methods: [{ kind: "email", value: "rejected@invalid.test", isPrimary: true }],
      now: NOW,
    });
    const rejectedEnrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: createSequence(fixture.client.db, fixture.tenantA, {
        name: "Reject seq",
        steps: [{ offsetDays: 0, templateId: template.id }],
        now: NOW,
      }).id,
      contactId: rejectedContact.id,
      opportunityId: opportunity.id,
      accountId: account.id,
      now: NOW,
    });
    const applied = applyToOpportunity(fixture.client.db, fixture.tenantA, {
      opportunityId: opportunity.id,
      portal: "Greenhouse",
      appliedOn: "2026-09-04",
      now: NOW,
    });
    updateApplication(fixture.client.db, fixture.tenantA, applied!.id, {
      stage: "rejected",
    });
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(rejectedEnrollment.id, rejectedEnrollment.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/application rejected/i);

    const referredCompany = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Referral Co",
      now: NOW,
    });
    const referredOpportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      companyId: referredCompany.id,
      role: "SDE",
      now: NOW,
    });
    const referredContact = createContact(fixture.client.db, fixture.tenantA, {
      id: "contact-referred",
      name: "Referred Contact",
      methods: [{ kind: "email", value: "referred@invalid.test", isPrimary: true }],
      now: NOW,
    });
    const referredEnrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: createSequence(fixture.client.db, fixture.tenantA, {
        name: "Referral seq",
        steps: [{ offsetDays: 0, templateId: template.id }],
        now: NOW,
      }).id,
      contactId: referredContact.id,
      opportunityId: referredOpportunity.id,
      accountId: account.id,
      now: NOW,
    });
    createReferral(fixture.client.db, fixture.tenantA, {
      contactId: referredContact.id,
      opportunityId: referredOpportunity.id,
      channel: "email",
      stage: "referral_received",
      todayOn: "2026-09-04",
      now: NOW,
    });
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(referredEnrollment.id, referredEnrollment.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/referral received/i);
  });

  it("cancels an approved row when a reply is recorded one second before the claim", async () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 1000));
    const claimAt = new Date(NOW.valueOf() + 60_000);
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: claimAt, approve: true, now: NOW },
    );
    createInteraction(fixture.client.db, fixture.tenantA, {
      contactId: contact.id,
      channel: "email",
      direction: "inbound",
      body: "Thanks",
      occurredAt: new Date(claimAt.valueOf() - 1000),
      now: new Date(claimAt.valueOf() - 1000),
    });
    const port = mailPort();
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: claimAt },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(listEnrollments(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "cancelled",
      cancelReason: "reply",
    });
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "cancelled",
      lastError: "Cancelled — reply received",
    });
  });

  it("keeps sequence rows, replies and reviews inside one workspace", () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollmentA = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    expect(
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantB,
        sequenceDueSourceKey(enrollmentA.id, enrollmentA.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toBeUndefined();
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantB, { now: NOW }).doNow.some(
        (item) => item.entityId === contact.id,
      ),
    ).toBe(false);
  });

  it("does not let a second account's freshness stamp release the enrollment", async () => {
    const { fixture, account, otherAccount, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    stampSafe(fixture, otherAccount.id, new Date(NOW.valueOf() + 1000));
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: true, now: NOW },
    );
    const port = mailPort();
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: NOW },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(
      getQueueMessage(
        fixture.client.db,
        fixture.tenantA,
        sequenceQueueRowId(enrollment.id, enrollment.currentStepId),
      ),
    ).toMatchObject({
      status: "held",
      lastError: HELD_MAILBOX_UNPROVEN,
      approvalHash: expect.any(String),
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 2000));
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: new Date(NOW.valueOf() + 2000) },
    );
    expect(port.send).toHaveBeenCalledOnce();
    expect(port.send.mock.calls[0]?.[0]).toMatchObject({ fromEmail: "sender@invalid.test" });
  });

  it("holds when sync is stubbed to fail and does not cancel or advance", async () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: true, now: NOW },
    );
    const port = mailPort();
    await runTick(
      fixture.client.db,
      {
        mailPort: port,
        tokenKey: TOKEN_KEY,
        read: { port: failingReadPort(), tokenKey: TOKEN_KEY },
      },
      { now: NOW },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(listEnrollments(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "active",
      currentStepId: enrollment.currentStepId,
    });
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "held",
      lastError: HELD_MAILBOX_UNPROVEN,
    });
  });

  it("holds past max_sync_age", async () => {
    const { fixture, account, contact, sequence } = setup();
    const enrolledAt = new Date(NOW.valueOf() - 12 * 60_000);
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: enrolledAt,
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() - 11 * 60_000));
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: true, now: NOW },
    );
    const port = mailPort();
    await flushSendQueue(
      fixture.client.db,
      { mailPort: port, tokenKey: TOKEN_KEY },
      { now: NOW },
    );
    expect(port.send).not.toHaveBeenCalled();
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)[0]?.lastError).toBe(
      HELD_MAILBOX_UNPROVEN,
    );
  });

  it("stops every saved row and removes the derived review item", () => {
    const { fixture, account, contact, sequence } = setup();
    const enrollment = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      accountId: account.id,
      now: NOW,
    });
    stampSafe(fixture, account.id, new Date(NOW.valueOf() + 1000));
    saveSequenceReview(
      fixture.client.db,
      fixture.tenantA,
      sequenceDueSourceKey(enrollment.id, enrollment.currentStepId),
      { sendAt: NOW, approve: false, now: NOW },
    );
    stopEnrollment(fixture.client.db, fixture.tenantA, enrollment.id, NOW);
    expect(listEnrollments(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "cancelled",
      cancelReason: "manual_stop",
    });
    expect(listQueueMessages(fixture.client.db, fixture.tenantA)[0]).toMatchObject({
      status: "cancelled",
      lastError: "Cancelled — manual stop",
    });
    expect(
      getTodaySnapshot(fixture.client.db, fixture.tenantA, { now: NOW }).doNow.some(
        (item) => item.title === REVIEW_FOLLOW_UP_EMAIL,
      ),
    ).toBe(false);
  });

  it("cancels on do-not-contact and a closed opportunity", () => {
    const { fixture, account, contact, sequence, template } = setup();
    const company = createCompany(fixture.client.db, fixture.tenantA, {
      name: "Closed Co",
      now: NOW,
    });
    const opportunity = createOpportunity(fixture.client.db, fixture.tenantA, {
      companyId: company.id,
      role: "SDE",
      now: NOW,
    });
    const dnc = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: sequence.id,
      contactId: contact.id,
      opportunityId: opportunity.id,
      accountId: account.id,
      now: NOW,
    });
    updateContact(fixture.client.db, fixture.tenantA, contact.id, {
      networkingStatus: "do_not_contact",
      overrideDoNotContact: true,
    });
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(dnc.id, dnc.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/do not contact/i);

    updateContact(fixture.client.db, fixture.tenantA, contact.id, {
      networkingStatus: "contacted",
      overrideDoNotContact: true,
    });
    const closed = enrollSequence(fixture.client.db, fixture.tenantA, {
      sequenceId: createSequence(fixture.client.db, fixture.tenantA, {
        name: "Closed seq",
        steps: [{ offsetDays: 0, templateId: template.id }],
        now: NOW,
      }).id,
      contactId: contact.id,
      opportunityId: opportunity.id,
      accountId: account.id,
      now: NOW,
    });
    updateOpportunity(fixture.client.db, fixture.tenantA, opportunity.id, {
      stage: "position_closed",
    });
    expect(() =>
      saveSequenceReview(
        fixture.client.db,
        fixture.tenantA,
        sequenceDueSourceKey(closed.id, closed.currentStepId),
        { sendAt: NOW, approve: true, now: NOW },
      ),
    ).toThrow(/opportunity closed/i);
  });
});
