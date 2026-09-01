import { describe, expect, it } from "vitest";

import {
  INTERACTION_CHANNELS,
  INTERACTION_DIRECTIONS,
  formatInteractionOccurredAt,
  isInteractionChannel,
  isInteractionDirection,
} from "./interaction";

describe("interaction domain", () => {
  it("ships every §11 channel in its published order", () => {
    expect(INTERACTION_CHANNELS.map(({ label }) => label)).toEqual([
      "Email",
      "LinkedIn DM",
      "LinkedIn connection note",
      "WhatsApp",
      "Phone",
      "Telegram",
      "Slack / Discord",
      "Company referral portal",
      "Alumni network",
      "College network",
      "In-person",
      "Other",
    ]);
  });

  it("accepts only the published channels and directions", () => {
    expect(INTERACTION_DIRECTIONS.map(({ value }) => value)).toEqual([
      "outbound",
      "inbound",
    ]);
    expect(isInteractionChannel("whatsapp")).toBe(true);
    expect(isInteractionChannel("linkedin")).toBe(false);
    expect(isInteractionDirection("inbound")).toBe(true);
    expect(isInteractionDirection("received")).toBe(false);
  });

  it("formats occurred-at instants in the workspace timezone", () => {
    expect(
      formatInteractionOccurredAt(
        new Date("2026-08-30T10:32:00.000Z"),
        "Asia/Kolkata",
      ),
    ).toMatch(/30 Aug 2026/);
    expect(
      formatInteractionOccurredAt(
        new Date("2026-08-30T10:32:00.000Z"),
        "Asia/Kolkata",
      ),
    ).toMatch(/16:02/);
  });
});
