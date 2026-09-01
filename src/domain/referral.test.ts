import { describe, expect, it } from "vitest";

import {
  REFERRAL_STAGES,
  ReferralStageTransitionError,
  isReferralCorrection,
  matchesNoReplyPreset,
  matchesPromisedNotReceivedPreset,
  matchesReceivedNotAppliedPreset,
  selectableReferralStages,
  transitionReferralStage,
} from "./referral";

describe("referral domain", () => {
  it("ships every section 10 stage in published order", () => {
    expect(REFERRAL_STAGES.map(({ label }) => label)).toEqual([
      "Potential Contact",
      "Ready to Contact",
      "Requested",
      "Seen / Acknowledged",
      "Asked for Resume",
      "Resume Sent",
      "Agreed to Refer",
      "Referral Promised",
      "Referral Submitted",
      "Referral Received",
      "Declined",
      "No Response",
      "Expired",
      "Cancelled",
    ]);
  });

  it("keeps Potential Contact selectable after Referral Received", () => {
    expect(
      selectableReferralStages("referral_received").map(({ label }) => label),
    ).toContain("Potential Contact");
    expect(
      transitionReferralStage("referral_received", "potential_contact"),
    ).toBe("potential_contact");
    expect(
      isReferralCorrection("referral_received", "potential_contact"),
    ).toBe(true);
  });

  it("rejects resurrecting a closed referral into a later happy-path stage", () => {
    expect(() =>
      transitionReferralStage("cancelled", "referral_received"),
    ).toThrow(ReferralStageTransitionError);
    expect(() =>
      transitionReferralStage("declined", "referral_promised"),
    ).toThrow(ReferralStageTransitionError);
    expect(() =>
      transitionReferralStage("expired", "requested"),
    ).toThrow(ReferralStageTransitionError);
    expect(transitionReferralStage("cancelled", "potential_contact")).toBe(
      "potential_contact",
    );
    expect(transitionReferralStage("requested", "declined")).toBe("declined");
    expect(transitionReferralStage("requested", "referral_promised")).toBe(
      "referral_promised",
    );
  });

  it("names the three list presets from section 10", () => {
    expect(
      matchesNoReplyPreset(
        { stage: "requested", requestedOn: "2026-08-20" },
        "2026-09-01",
      ),
    ).toBe(true);
    expect(
      matchesNoReplyPreset(
        { stage: "requested", requestedOn: "2026-08-29" },
        "2026-09-01",
      ),
    ).toBe(false);
    expect(
      matchesNoReplyPreset(
        { stage: "referral_promised", requestedOn: "2026-08-20" },
        "2026-09-01",
      ),
    ).toBe(false);
    expect(matchesPromisedNotReceivedPreset("requested")).toBe(false);
    expect(matchesPromisedNotReceivedPreset("referral_promised")).toBe(true);
    expect(matchesPromisedNotReceivedPreset("referral_submitted")).toBe(true);
    expect(matchesReceivedNotAppliedPreset("referral_received", false)).toBe(
      true,
    );
    expect(matchesReceivedNotAppliedPreset("referral_received", true)).toBe(
      false,
    );
  });
});
