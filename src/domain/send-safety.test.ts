import { describe, expect, it } from "vitest";

import {
  canonicalSendPayload,
  hashSendPayload,
  queueMessageId,
  tomorrowMorningSlot,
} from "./send-safety";

const payload = {
  recipient: "Owner@Invalid.Test",
  accountId: "account-a",
  subject: "Referral request",
  body: "Hello\n\nComplete body",
  attachmentVersionIds: ["version-b", "version-a"],
  sendAt: new Date("2026-09-04T03:30:00.000Z"),
};

describe("send safety payload", () => {
  it("canonicalises every approval-bound field in a fixed order", () => {
    expect(canonicalSendPayload(payload)).toBe(
      JSON.stringify({
        version: 1,
        recipient: "owner@invalid.test",
        accountId: "account-a",
        subject: "Referral request",
        body: "Hello\n\nComplete body",
        attachmentVersionIds: ["version-b", "version-a"],
        sendAt: "2026-09-04T03:30:00.000Z",
      }),
    );
  });

  it.each([
    ["recipient", { recipient: "other@invalid.test" }],
    ["account", { accountId: "account-b" }],
    ["subject", { subject: "One byte changed" }],
    ["body", { body: "Hello\n\nComplete body!" }],
    ["attachment order", { attachmentVersionIds: ["version-a", "version-b"] }],
    ["send time", { sendAt: new Date("2026-09-04T03:32:00.000Z") }],
  ])("changes the hash when %s changes", (_label, change) => {
    expect(hashSendPayload({ ...payload, ...change })).not.toBe(
      hashSendPayload(payload),
    );
  });

  it("mints the deterministic RFC 822 id from the queue row and sender domain", () => {
    expect(queueMessageId("queue-row-1", "Sender@Invalid.Test")).toBe(
      "<jp-queue-row-1@invalid.test>",
    );
  });

  it("spreads tomorrow-morning rows from the next weekday window start", () => {
    const friday = new Date("2026-09-04T12:00:00.000Z");
    expect(
      [0, 1, 2].map((ordinal) =>
        tomorrowMorningSlot({
          timeZone: "Asia/Kolkata",
          now: friday,
          windowStart: 9 * 60,
          windowEnd: 18 * 60,
          ordinal,
        }).toISOString(),
      ),
    ).toEqual([
      "2026-09-07T03:30:00.000Z",
      "2026-09-07T03:32:00.000Z",
      "2026-09-07T03:34:00.000Z",
    ]);
  });
});
