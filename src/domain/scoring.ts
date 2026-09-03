export type ScoringTermKey =
  | "targetCompany"
  | "newGradRole"
  | "preferredLocation"
  | "referralAvailable"
  | "postedWithin48Hours"
  | "experienceExceedsEligibility";

export type ScoringTerm = {
  key: ScoringTermKey;
  label: string;
  defaultWeight: number;
};

export const SCORING_TERMS = [
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
] as const satisfies readonly ScoringTerm[];

export type ScoringWeights = Record<ScoringTermKey, number>;
export type OpportunityScoringInputs = Record<ScoringTermKey, boolean>;

export const DEFAULT_SCORING_WEIGHTS: Readonly<ScoringWeights> = {
  targetCompany: 3,
  newGradRole: 3,
  preferredLocation: 2,
  referralAvailable: 2,
  postedWithin48Hours: 1,
  experienceExceedsEligibility: -3,
};

export type ScoredTerm = {
  key: ScoringTermKey;
  label: string;
  weight: number;
};

export type OpportunityScore = {
  score: number;
  terms: ScoredTerm[];
};

export function scoreOpportunity(
  inputs: OpportunityScoringInputs,
  overrides: Partial<ScoringWeights> = {},
): OpportunityScore {
  const terms = SCORING_TERMS.flatMap<ScoredTerm>((term) => {
    if (!inputs[term.key]) {
      return [];
    }
    return [
      {
        key: term.key,
        label: term.label,
        weight: overrides[term.key] ?? term.defaultWeight,
      },
    ];
  });

  return {
    score: terms.reduce((total, term) => total + term.weight, 0),
    terms,
  };
}
