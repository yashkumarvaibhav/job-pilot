import { dueSourceKey } from "./due-source";
import { calendarDateInZone, shiftCalendarDate } from "./referral";
import { zonedInterviewAt } from "./interview";

export const DEFAULT_SEQUENCE_OFFSET_DAYS = [0, 4, 9, 16] as const;

export const MAX_SYNC_AGE_MS = 10 * 60_000;

export const HELD_MAILBOX_UNPROVEN = "held — mailbox state unproven";

export const REVIEW_FOLLOW_UP_EMAIL = "Review follow-up email";

export const SEQUENCE_ENROLLMENT_COPY =
  "Each due email requires your approval.";

export const SEQUENCE_STOP_REASON_COPY = [
  "Reply received",
  "Referral received",
  "Opportunity closed",
  "Application rejected",
  "Bounce",
  "Do not contact",
  "Manual stop",
] as const;

export const SEQUENCE_CANCEL_REASONS = [
  "reply",
  "bounce",
  "dnc",
  "opportunity_closed",
  "application_rejected",
  "referral_received",
  "manual_stop",
] as const;

export type SequenceCancelReason = (typeof SEQUENCE_CANCEL_REASONS)[number];

export const SEQUENCE_CANCEL_COPY: Record<SequenceCancelReason, string> = {
  reply: "Cancelled — reply received",
  bounce: "Cancelled — bounce",
  dnc: "Cancelled — do not contact",
  opportunity_closed: "Cancelled — opportunity closed",
  application_rejected: "Cancelled — application rejected",
  referral_received: "Cancelled — referral received",
  manual_stop: "Cancelled — manual stop",
};

export const SEQUENCE_STATUSES = ["active", "cancelled", "completed"] as const;
export type SequenceEnrollmentStatus = (typeof SEQUENCE_STATUSES)[number];

const OVERRIDE_KEYS = new Set([
  "sendAnyway",
  "freshnessOverride",
  "skipSync",
  "forceSend",
]);

export type SequenceCancelInput = {
  claimAt: Date;
  replyAt: Date | null;
  bounced: boolean;
  doNotContact: boolean;
  opportunityClosed: boolean;
  applicationRejected: boolean;
  referralReceived: boolean;
  manualStop: boolean;
};

export function detectSequenceCancel(
  input: SequenceCancelInput,
): SequenceCancelReason | null {
  if (input.manualStop) return "manual_stop";
  if (input.replyAt && input.replyAt.valueOf() <= input.claimAt.valueOf()) {
    return "reply";
  }
  if (input.bounced) return "bounce";
  if (input.doNotContact) return "dnc";
  if (input.opportunityClosed) return "opportunity_closed";
  if (input.applicationRejected) return "application_rejected";
  if (input.referralReceived) return "referral_received";
  return null;
}

export function sequenceRequestGrantsOverride(
  origin: string,
  keys: readonly string[],
): boolean {
  return origin === "sequence" && keys.some((key) => OVERRIDE_KEYS.has(key));
}

export type SequenceMailboxProof = {
  accountStatus: "connected" | "disconnected" | "error";
  sequenceSafeAt: Date | null;
  enrolledAt: Date;
  threadId: string | null;
  threadProvenAt: Date | null;
  recoveryOpen: boolean;
  now: Date;
  maxSyncAgeMs?: number;
};

export type SequenceFreshnessDecision =
  | { ok: true }
  | { ok: false; hold: typeof HELD_MAILBOX_UNPROVEN; reason: string };

export function sequenceMailboxFreshness(
  input: SequenceMailboxProof,
): SequenceFreshnessDecision {
  const hold = (reason: string): SequenceFreshnessDecision => ({
    ok: false,
    hold: HELD_MAILBOX_UNPROVEN,
    reason,
  });
  if (input.accountStatus !== "connected") return hold("disconnected");
  if (input.recoveryOpen) return hold("recovery");
  if (!input.sequenceSafeAt) return hold("unproven");
  if (input.sequenceSafeAt.valueOf() < input.enrolledAt.valueOf()) {
    return hold("unproven");
  }
  const maxAge = input.maxSyncAgeMs ?? MAX_SYNC_AGE_MS;
  if (input.now.valueOf() - input.sequenceSafeAt.valueOf() > maxAge) {
    return hold("stale");
  }
  if (input.threadId) {
    if (
      !input.threadProvenAt ||
      input.threadProvenAt.valueOf() < input.enrolledAt.valueOf()
    ) {
      return hold("thread");
    }
  }
  return { ok: true };
}

export function lastSyncedCopy(lastSyncAt: Date | null, now: Date): string {
  if (!lastSyncAt) return "Mailbox has never been synced.";
  const elapsed = now.valueOf() - lastSyncAt.valueOf();
  if (elapsed < 60_000) return "last synced just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) {
    return minutes === 1
      ? "last synced 1 minute ago"
      : `last synced ${minutes} minutes ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return hours === 1
      ? "last synced 1 hour ago"
      : `last synced ${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "last synced 1 day ago" : `last synced ${days} days ago`;
}

function clockHm(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function sequenceStepDueAt(
  enrolledAt: Date,
  offsetDays: number,
  timeZone: string,
): Date {
  if (!Number.isInteger(offsetDays) || offsetDays < 0) {
    throw new RangeError("Sequence offsets must be whole non-negative days.");
  }
  if (offsetDays === 0) return enrolledAt;
  const dueOn = shiftCalendarDate(
    calendarDateInZone(timeZone, enrolledAt),
    offsetDays,
  );
  return zonedInterviewAt(timeZone, dueOn, clockHm(timeZone, enrolledAt));
}

export function nextEnrollmentDueAt(input: {
  enrolledAt: Date;
  offsets: readonly number[];
  currentIndex: number;
  currentStepSent: boolean;
  timeZone: string;
  now: Date;
}): Date | null {
  void input.now;
  if (
    !Number.isInteger(input.currentIndex) ||
    input.currentIndex < 0 ||
    input.currentIndex >= input.offsets.length
  ) {
    return null;
  }
  if (!input.currentStepSent) {
    return sequenceStepDueAt(
      input.enrolledAt,
      input.offsets[input.currentIndex]!,
      input.timeZone,
    );
  }
  const next = input.currentIndex + 1;
  if (next >= input.offsets.length) return null;
  return sequenceStepDueAt(input.enrolledAt, input.offsets[next]!, input.timeZone);
}

export function sequenceDueSourceKey(
  enrollmentId: string,
  stepId: string,
): string {
  const enrollment = enrollmentId.trim();
  const step = stepId.trim();
  if (!enrollment || !step) {
    throw new RangeError("A sequence due-source key needs enrollment and step ids.");
  }
  return dueSourceKey("sequence_follow_up", `${enrollment}/${step}`);
}

export function parseSequenceDueSourceKey(
  key: string,
): { enrollmentId: string; stepId: string } | null {
  const match = key.match(/^enrollment:(.+):step:(.+)$/);
  if (!match) return null;
  return { enrollmentId: match[1], stepId: match[2] };
}
