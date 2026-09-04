import { describe, expect, it } from "vitest";

import { hashSendPayload } from "./send-safety";
import {
  DEFAULT_SEQUENCE_OFFSET_DAYS,
  HELD_MAILBOX_UNPROVEN,
  REVIEW_FOLLOW_UP_EMAIL,
  SEQUENCE_CANCEL_COPY,
  SEQUENCE_ENROLLMENT_COPY,
  detectSequenceCancel,
  lastSyncedCopy,
  nextEnrollmentDueAt,
  sequenceMailboxFreshness,
  sequenceRequestGrantsOverride,
  sequenceStepDueAt,
} from "./sequence";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const ENROLLED = new Date("2026-09-04T09:50:00.000Z");

describe("sequence approval and cancel invariants", () => {
  it("expresses the spec offsets and review copy without treating enrollment as approval", () => {
    expect(DEFAULT_SEQUENCE_OFFSET_DAYS).toEqual([0, 4, 9, 16]);
    expect(REVIEW_FOLLOW_UP_EMAIL).toBe("Review follow-up email");
    expect(SEQUENCE_ENROLLMENT_COPY).toBe("Each due email requires your approval.");
    expect(SEQUENCE_CANCEL_COPY.reply).toBe("Cancelled — reply received");
    expect(SEQUENCE_CANCEL_COPY.manual_stop).toBe("Cancelled — manual stop");
  });

  it("cancels on a reply recorded one second before the claim", () => {
    const claimAt = new Date("2026-09-04T09:00:00.000Z");
    const replyAt = new Date(claimAt.valueOf() - 1000);
    expect(
      detectSequenceCancel({
        claimAt,
        replyAt,
        bounced: false,
        doNotContact: false,
        opportunityClosed: false,
        applicationRejected: false,
        referralReceived: false,
        manualStop: false,
      }),
    ).toBe("reply");
  });

  it("cancels on bounce, DNC, closed opportunity, rejected application, referral and stop", () => {
    const base = {
      claimAt: NOW,
      replyAt: null,
      bounced: false,
      doNotContact: false,
      opportunityClosed: false,
      applicationRejected: false,
      referralReceived: false,
      manualStop: false,
    };
    expect(detectSequenceCancel({ ...base, bounced: true })).toBe("bounce");
    expect(detectSequenceCancel({ ...base, doNotContact: true })).toBe("dnc");
    expect(detectSequenceCancel({ ...base, opportunityClosed: true })).toBe(
      "opportunity_closed",
    );
    expect(detectSequenceCancel({ ...base, applicationRejected: true })).toBe(
      "application_rejected",
    );
    expect(detectSequenceCancel({ ...base, referralReceived: true })).toBe(
      "referral_received",
    );
    expect(detectSequenceCancel({ ...base, manualStop: true })).toBe("manual_stop");
    expect(detectSequenceCancel(base)).toBeNull();
  });

  it("ignores a reply that arrives after the claim instant", () => {
    expect(
      detectSequenceCancel({
        claimAt: NOW,
        replyAt: new Date(NOW.valueOf() + 1000),
        bounced: false,
        doNotContact: false,
        opportunityClosed: false,
        applicationRejected: false,
        referralReceived: false,
        manualStop: false,
      }),
    ).toBeNull();
  });

  it("clears approval when any bound field changes", () => {
    const approved = hashSendPayload({
      recipient: "priya@invalid.test",
      accountId: "account-a",
      subject: "Hello",
      body: "Body",
      attachmentVersionIds: ["resume-v1"],
      sendAt: NOW,
    });
    const edited = hashSendPayload({
      recipient: "priya@invalid.test",
      accountId: "account-a",
      subject: "Hello",
      body: "Body!",
      attachmentVersionIds: ["resume-v1"],
      sendAt: NOW,
    });
    expect(edited).not.toBe(approved);
  });

  it("never treats a sequence request shape as a freshness override", () => {
    expect(sequenceRequestGrantsOverride("sequence", ["sendAnyway"])).toBe(true);
    expect(sequenceRequestGrantsOverride("sequence", ["freshnessOverride"])).toBe(
      true,
    );
    expect(sequenceRequestGrantsOverride("sequence", ["skipSync"])).toBe(true);
    expect(sequenceRequestGrantsOverride("sequence", ["sendAt"])).toBe(false);
    expect(sequenceRequestGrantsOverride("one_off", ["sendAnyway"])).toBe(false);
  });
});

describe("sequence mailbox freshness", () => {
  it("holds disconnected, stale, pre-enrollment and unproven-thread mailboxes", () => {
    const fresh = new Date(NOW.valueOf() - 60_000);
    expect(
      sequenceMailboxFreshness({
        accountStatus: "disconnected",
        sequenceSafeAt: fresh,
        enrolledAt: ENROLLED,
        threadId: null,
        threadProvenAt: null,
        recoveryOpen: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, hold: HELD_MAILBOX_UNPROVEN, reason: "disconnected" });

    expect(
      sequenceMailboxFreshness({
        accountStatus: "connected",
        sequenceSafeAt: new Date(NOW.valueOf() - 11 * 60_000),
        enrolledAt: new Date(NOW.valueOf() - 12 * 60_000),
        threadId: null,
        threadProvenAt: null,
        recoveryOpen: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, hold: HELD_MAILBOX_UNPROVEN, reason: "stale" });

    expect(
      sequenceMailboxFreshness({
        accountStatus: "connected",
        sequenceSafeAt: new Date(NOW.valueOf() - 2 * 60_000),
        enrolledAt: new Date(NOW.valueOf() - 60_000),
        threadId: null,
        threadProvenAt: null,
        recoveryOpen: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, hold: HELD_MAILBOX_UNPROVEN, reason: "unproven" });

    expect(
      sequenceMailboxFreshness({
        accountStatus: "connected",
        sequenceSafeAt: fresh,
        enrolledAt: ENROLLED,
        threadId: "thread-1",
        threadProvenAt: null,
        recoveryOpen: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, hold: HELD_MAILBOX_UNPROVEN, reason: "thread" });

    expect(
      sequenceMailboxFreshness({
        accountStatus: "connected",
        sequenceSafeAt: fresh,
        enrolledAt: ENROLLED,
        threadId: null,
        threadProvenAt: null,
        recoveryOpen: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, hold: HELD_MAILBOX_UNPROVEN, reason: "recovery" });
  });

  it("does not treat last_sync_at as the sequence gate", () => {
    const proof = sequenceMailboxFreshness({
      accountStatus: "connected",
      sequenceSafeAt: new Date(NOW.valueOf() - 60_000),
      enrolledAt: ENROLLED,
      threadId: null,
      threadProvenAt: null,
      recoveryOpen: false,
      now: NOW,
    });
    expect(proof).toEqual({ ok: true });
  });

  it("accepts a thread proven after enrollment when the account stamp is fresh", () => {
    expect(
      sequenceMailboxFreshness({
        accountStatus: "connected",
        sequenceSafeAt: new Date(NOW.valueOf() - 30_000),
        enrolledAt: ENROLLED,
        threadId: "thread-1",
        threadProvenAt: new Date(ENROLLED.valueOf() + 1000),
        recoveryOpen: false,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });
});

describe("one-off staleness copy", () => {
  it("names the actual lag for the composer send-anyway path", () => {
    expect(lastSyncedCopy(null, NOW)).toBe("Mailbox has never been synced.");
    expect(lastSyncedCopy(new Date(NOW.valueOf() - 3 * 3600_000), NOW)).toBe(
      "last synced 3 hours ago",
    );
  });
});

describe("sequence offsets and overdue wait", () => {
  it("keeps an unsent day-0 step due even after later offsets have passed", () => {
    const enrolledAt = new Date("2026-09-04T04:00:00.000Z");
    const day0 = sequenceStepDueAt(enrolledAt, 0, "Asia/Kolkata");
    const later = new Date("2026-09-20T04:00:00.000Z");
    expect(
      nextEnrollmentDueAt({
        enrolledAt,
        offsets: [...DEFAULT_SEQUENCE_OFFSET_DAYS],
        currentIndex: 0,
        currentStepSent: false,
        timeZone: "Asia/Kolkata",
        now: later,
      }),
    ).toEqual(day0);
  });

  it("advances only after the current step is confirmed sent", () => {
    const enrolledAt = new Date("2026-09-04T04:00:00.000Z");
    const day4 = sequenceStepDueAt(enrolledAt, 4, "Asia/Kolkata");
    expect(
      nextEnrollmentDueAt({
        enrolledAt,
        offsets: [...DEFAULT_SEQUENCE_OFFSET_DAYS],
        currentIndex: 0,
        currentStepSent: true,
        timeZone: "Asia/Kolkata",
        now: enrolledAt,
      }),
    ).toEqual(day4);
  });
});
