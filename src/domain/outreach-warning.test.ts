import { describe, expect, it } from "vitest";

import {
  formatCooldownWarning,
  formatDuplicateOutreachWarning,
  isWithinCooldown,
  shouldWarnDuplicateOutreach,
} from "./outreach-warning";

describe("outreach warnings", () => {
  it("formats the §52 cooldown paragraph with last channel and last response", () => {
    expect(
      formatCooldownWarning({
        contactName: "Rohit",
        daysAgo: 16,
        companyName: "Amazon",
        role: "SDE II",
        channelCounts: [
          { channel: "email", count: 1 },
          { channel: "linkedin_dm", count: 1 },
          { channel: "linkedin_connection_note", count: 1 },
        ],
        lastChannel: "email",
        lastResponseBody: "No openings on my team currently.",
      }),
    ).toBe(
      [
        "You contacted Rohit 16 days ago.",
        "",
        "Company: Amazon",
        "Role: SDE II",
        "",
        "1 email",
        "2 LinkedIn interactions",
        "",
        "Last channel: Email",
        "Last response:",
        '"No openings on my team currently."',
        "",
        "Continue?",
      ].join("\n"),
    );
  });

  it("warns inside 30 days and not on the 30th day", () => {
    const last = new Date("2026-08-05T10:00:00.000Z");
    expect(isWithinCooldown(last, new Date("2026-09-03T10:00:00.000Z"))).toBe(
      true,
    );
    expect(isWithinCooldown(last, new Date("2026-09-04T10:00:00.000Z"))).toBe(
      false,
    );
  });

  it("warns after six people at the same company for the same opportunity", () => {
    expect(shouldWarnDuplicateOutreach(5)).toBe(false);
    expect(shouldWarnDuplicateOutreach(6)).toBe(true);
    expect(formatDuplicateOutreachWarning(6)).toBe(
      "You have already contacted 6 people at this company for this opportunity.",
    );
  });
});
