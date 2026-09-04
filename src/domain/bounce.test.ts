import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseBounceSignal, type BounceParseInput } from "./bounce";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "bounce-fixtures");

function fixture(name: string): BounceParseInput {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as BounceParseInput;
}

describe("bounce signal parser", () => {
  it("classifies a 550 mailbox-unavailable DSN as a hard bounce", () => {
    expect(parseBounceSignal(fixture("hard-550-mailbox-unavailable.json"))).toEqual({
      kind: "hard",
      recipient: "priya@invalid.test",
      smtpStatus: "5.1.1",
      diagnostic:
        "550-5.1.1 The email account that you tried to reach does not exist. 550 mailbox unavailable",
    });
  });

  it("classifies a 5xx delivery-status Status as a hard bounce", () => {
    expect(parseBounceSignal(fixture("hard-5xx-status-only.json"))).toEqual({
      kind: "hard",
      recipient: "sixth@invalid.test",
      smtpStatus: "5.0.0",
      diagnostic: "554 5.0.0 Transaction failed",
    });
  });

  it("classifies a 4xx delayed DSN as a soft bounce", () => {
    expect(parseBounceSignal(fixture("soft-452-mailbox-full.json"))).toEqual({
      kind: "soft",
      recipient: "rahul@invalid.test",
      smtpStatus: "4.2.2",
      diagnostic: "452 4.2.2 Mailbox full",
    });
  });

  it("ignores ordinary recruiting mail with no delivery-status part", () => {
    expect(parseBounceSignal(fixture("not-a-bounce.json"))).toBeNull();
  });

  it("does not invent a bounce when the DSN reports delivered", () => {
    expect(
      parseBounceSignal({
        fromEmail: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Success)",
        body: "Your message was delivered.",
        deliveryStatusText:
          "Final-Recipient: rfc822; priya@invalid.test\nAction: delivered\nStatus: 2.0.0\n",
      }),
    ).toBeNull();
  });

  it("does not treat a recruiting reply that mentions a missing address as a bounce", () => {
    expect(
      parseBounceSignal({
        fromEmail: "recruiter@invalid.test",
        subject: "Re: SDE II",
        body: "That mailbox does not exist on my team.",
      }),
    ).toBeNull();
  });
});
