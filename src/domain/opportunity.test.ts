import { describe, expect, it } from "vitest";

import {
  OPPORTUNITY_PURSUIT_STAGES,
  OPPORTUNITY_SELECTABLE_STAGES,
  OPPORTUNITY_TERMINAL_STAGES,
} from "./opportunity";

describe("opportunity domain", () => {
  it("ships the pursuit stages through Ready to Apply in their published order", () => {
    expect(OPPORTUNITY_PURSUIT_STAGES.map(({ label }) => label)).toEqual([
      "Discovered",
      "Saved",
      "Interested",
      "Pursuing",
      "Finding Contacts",
      "Finding Referral",
      "Referral Requested",
      "Referral Promised",
      "Referral Received",
      "Ready to Apply",
    ]);
  });

  it("ships only the pre-application terminal stages from the published list", () => {
    expect(OPPORTUNITY_TERMINAL_STAGES.map(({ label }) => label)).toEqual([
      "Ghosted",
      "Position Closed",
      "Withdrawn",
      "Not Eligible",
      "Duplicate",
      "No Longer Interested",
      "Expired",
    ]);
  });

  it("does not expose applied or post-application stages as opportunity choices", () => {
    const labels = OPPORTUNITY_SELECTABLE_STAGES.map(({ label }) => label);

    expect(labels).toEqual([
      ...OPPORTUNITY_PURSUIT_STAGES.map(({ label }) => label),
      ...OPPORTUNITY_TERMINAL_STAGES.map(({ label }) => label),
    ]);
    expect(labels).not.toEqual(
      expect.arrayContaining([
        "Applied",
        "Application Confirmed",
        "Under Review",
        "OA Received",
        "Interview Scheduled",
        "Offer",
        "Accepted",
        "Rejected",
      ]),
    );
  });
});
