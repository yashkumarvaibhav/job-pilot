export const OPPORTUNITY_PURSUIT_STAGES = [
  { value: "discovered", label: "Discovered" },
  { value: "saved", label: "Saved" },
  { value: "interested", label: "Interested" },
  { value: "pursuing", label: "Pursuing" },
  { value: "finding_contacts", label: "Finding Contacts" },
  { value: "finding_referral", label: "Finding Referral" },
  { value: "referral_requested", label: "Referral Requested" },
  { value: "referral_promised", label: "Referral Promised" },
  { value: "referral_received", label: "Referral Received" },
  { value: "ready_to_apply", label: "Ready to Apply" },
] as const;

export const OPPORTUNITY_BUCKETS = [
  { value: "saved", label: "Saved" },
  { value: "active", label: "Active" },
] as const;

export type OpportunityBucket =
  (typeof OPPORTUNITY_BUCKETS)[number]["value"];

export const DEFAULT_OPPORTUNITY_BUCKET: OpportunityBucket = "saved";
export const DEFAULT_OPPORTUNITY_STAGE: OpportunitySelectableStage =
  "discovered";

export const OPPORTUNITY_TERMINAL_STAGES = [
  { value: "ghosted", label: "Ghosted" },
  { value: "position_closed", label: "Position Closed" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "not_eligible", label: "Not Eligible" },
  { value: "duplicate", label: "Duplicate" },
  { value: "no_longer_interested", label: "No Longer Interested" },
  { value: "expired", label: "Expired" },
] as const;

export const OPPORTUNITY_SELECTABLE_STAGES = [
  ...OPPORTUNITY_PURSUIT_STAGES,
  ...OPPORTUNITY_TERMINAL_STAGES,
] as const;

export const OPPORTUNITY_APPLIED_STAGE = {
  value: "applied",
  label: "Applied",
} as const;

export const OPPORTUNITY_STAGES = [
  ...OPPORTUNITY_PURSUIT_STAGES,
  OPPORTUNITY_APPLIED_STAGE,
  ...OPPORTUNITY_TERMINAL_STAGES,
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number]["value"];
export type OpportunitySelectableStage =
  (typeof OPPORTUNITY_SELECTABLE_STAGES)[number]["value"];

const opportunityStageValues = new Set<string>(
  OPPORTUNITY_STAGES.map(({ value }) => value),
);
const opportunityBucketValues = new Set<string>(
  OPPORTUNITY_BUCKETS.map(({ value }) => value),
);
const selectableStageValues = new Set<string>(
  OPPORTUNITY_SELECTABLE_STAGES.map(({ value }) => value),
);

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return typeof value === "string" && opportunityStageValues.has(value);
}

export function isOpportunitySelectableStage(
  value: unknown,
): value is OpportunitySelectableStage {
  return typeof value === "string" && selectableStageValues.has(value);
}

export function isOpportunityBucket(value: unknown): value is OpportunityBucket {
  return typeof value === "string" && opportunityBucketValues.has(value);
}

export function opportunityStageLabel(value: OpportunityStage): string {
  return OPPORTUNITY_STAGES.find((stage) => stage.value === value)!.label;
}

export function opportunityBucketLabel(value: OpportunityBucket): string {
  return OPPORTUNITY_BUCKETS.find((bucket) => bucket.value === value)!.label;
}
