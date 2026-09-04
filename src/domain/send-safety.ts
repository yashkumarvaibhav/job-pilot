import { createHash } from "node:crypto";

import { zonedInterviewAt } from "./interview";
import { calendarDateInZone } from "./referral";

export const UNCERTAIN_DELIVERY_ERROR =
  "Delivery may already have occurred. Check Gmail Sent before approving a new attempt. Job Pilot will not retry automatically.";

export type SendPayload = Readonly<{
  recipient: string;
  accountId: string;
  subject: string;
  body: string;
  attachmentVersionIds: readonly string[];
  sendAt: Date;
}>;

export function canonicalSendPayload(payload: SendPayload): string {
  if (!(payload.sendAt instanceof Date) || Number.isNaN(payload.sendAt.valueOf())) {
    throw new TypeError("Send time must be a valid instant.");
  }
  return JSON.stringify({
    version: 1,
    recipient: payload.recipient.trim().toLowerCase(),
    accountId: payload.accountId.trim(),
    subject: payload.subject,
    body: payload.body,
    attachmentVersionIds: [...payload.attachmentVersionIds],
    sendAt: payload.sendAt.toISOString(),
  });
}

export function hashSendPayload(payload: SendPayload): string {
  return createHash("sha256")
    .update(canonicalSendPayload(payload), "utf8")
    .digest("hex");
}

export function queueMessageId(queueId: string, senderEmail: string): string {
  const id = queueId.trim();
  const domain = senderEmail.trim().toLowerCase().split("@")[1];
  if (!id || /[<>@\s]/.test(id) || !domain || /[<>\s]/.test(domain)) {
    throw new TypeError("Queue row and sender must form a valid Message-ID.");
  }
  return `<jp-${id}@${domain}>`;
}

export function tomorrowMorningSlot(input: {
  timeZone: string;
  now: Date;
  windowStart: number;
  windowEnd: number;
  ordinal: number;
  strideSeconds?: number;
}): Date {
  if (
    !Number.isInteger(input.ordinal) ||
    input.ordinal < 0 ||
    !Number.isInteger(input.windowStart) ||
    !Number.isInteger(input.windowEnd) ||
    input.windowStart < 0 ||
    input.windowEnd > 1439 ||
    input.windowStart >= input.windowEnd
  ) {
    throw new RangeError("A weekday send window and non-negative slot are required.");
  }
  const strideSeconds = input.strideSeconds ?? 120;
  if (!Number.isInteger(strideSeconds) || strideSeconds < 60) {
    throw new RangeError("Queue stride must be at least one whole minute.");
  }
  const current = calendarDateInZone(input.timeZone, input.now);
  const cursor = new Date(`${current}T00:00:00.000Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  const dateOn = cursor.toISOString().slice(0, 10);
  const minute = input.windowStart + Math.floor((input.ordinal * strideSeconds) / 60);
  if (minute >= input.windowEnd) {
    throw new RangeError("The sending window has no remaining queue slot.");
  }
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return zonedInterviewAt(input.timeZone, dateOn, `${hh}:${mm}`);
}
