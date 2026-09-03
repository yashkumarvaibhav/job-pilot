import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCORING_WEIGHTS,
  SCORING_TERMS,
  isScoringWeightInput,
  resolveScoringWeights,
  scoreOpportunity,
} from "./scoring";

describe("deterministic opportunity scoring", () => {
  it("names every section 60 term and preserves its documented default", () => {
    expect(SCORING_TERMS).toEqual([
      { key: "targetCompany", label: "Target company", defaultWeight: 3 },
      { key: "newGradRole", label: "New-grad role", defaultWeight: 3 },
      {
        key: "preferredLocation",
        label: "Preferred location",
        defaultWeight: 2,
      },
      {
        key: "referralAvailable",
        label: "Referral available",
        defaultWeight: 2,
      },
      {
        key: "postedWithin48Hours",
        label: "Posted within 48 hours",
        defaultWeight: 1,
      },
      {
        key: "experienceExceedsEligibility",
        label: "Experience requirement exceeds eligibility",
        defaultWeight: -3,
      },
    ]);
    expect(DEFAULT_SCORING_WEIGHTS).toEqual({
      targetCompany: 3,
      newGradRole: 3,
      preferredLocation: 2,
      referralAvailable: 2,
      postedWithin48Hours: 1,
      experienceExceedsEligibility: -3,
    });
  });

  it("adds only fired terms in stable formula order", () => {
    expect(
      scoreOpportunity({
        targetCompany: true,
        newGradRole: true,
        preferredLocation: true,
        referralAvailable: true,
        postedWithin48Hours: true,
        experienceExceedsEligibility: true,
      }),
    ).toEqual({
      score: 8,
      terms: [
        { key: "targetCompany", label: "Target company", weight: 3 },
        { key: "newGradRole", label: "New-grad role", weight: 3 },
        { key: "preferredLocation", label: "Preferred location", weight: 2 },
        { key: "referralAvailable", label: "Referral available", weight: 2 },
        {
          key: "postedWithin48Hours",
          label: "Posted within 48 hours",
          weight: 1,
        },
        {
          key: "experienceExceedsEligibility",
          label: "Experience requirement exceeds eligibility",
          weight: -3,
        },
      ],
    });
  });

  it("uses current overrides without changing an omitted default", () => {
    expect(
      scoreOpportunity(
        {
          targetCompany: true,
          newGradRole: true,
          preferredLocation: false,
          referralAvailable: false,
          postedWithin48Hours: false,
          experienceExceedsEligibility: false,
        },
        { targetCompany: 0, newGradRole: 7 },
      ),
    ).toEqual({
      score: 7,
      terms: [
        { key: "targetCompany", label: "Target company", weight: 0 },
        { key: "newGradRole", label: "New-grad role", weight: 7 },
      ],
    });
  });

  it("returns zero with no matching inputs", () => {
    expect(
      scoreOpportunity({
        targetCompany: false,
        newGradRole: false,
        preferredLocation: false,
        referralAvailable: false,
        postedWithin48Hours: false,
        experienceExceedsEligibility: false,
      }),
    ).toEqual({ score: 0, terms: [] });
  });

  it("accepts only named, finite whole-number overrides", () => {
    expect(isScoringWeightInput({ targetCompany: 0, newGradRole: -2 })).toBe(
      true,
    );
    expect(isScoringWeightInput({ hiddenTerm: 10 })).toBe(false);
    expect(isScoringWeightInput({ targetCompany: 1.5 })).toBe(false);
    expect(isScoringWeightInput({ targetCompany: Number.POSITIVE_INFINITY })).toBe(
      false,
    );
    expect(isScoringWeightInput(null)).toBe(false);
  });

  it("fills missing stored weights from the documented defaults", () => {
    expect(resolveScoringWeights({ targetCompany: 0 })).toEqual({
      ...DEFAULT_SCORING_WEIGHTS,
      targetCompany: 0,
    });
    expect(resolveScoringWeights({ hiddenTerm: 99, newGradRole: "many" })).toEqual(
      DEFAULT_SCORING_WEIGHTS,
    );
  });
});
