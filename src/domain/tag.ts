export const SUGGESTED_TAG_LABELS = [
  "Dream Company",
  "High Priority",
  "Java",
  "Backend",
  "Systems",
  "New Grad",
  "2027 Batch",
  "Remote",
  "Referral Possible",
  "Alumni Available",
  "Follow Up Later",
] as const;

export const TAG_ENTITY_TYPES = [
  "company",
  "contact",
  "opportunity",
] as const;

export type TagEntityType = (typeof TAG_ENTITY_TYPES)[number];

const entityTypeValues = new Set<string>(TAG_ENTITY_TYPES);

export function isTagEntityType(value: unknown): value is TagEntityType {
  return typeof value === "string" && entityTypeValues.has(value);
}

export type NormalizedTagLabel = {
  label: string;
  labelNormalized: string;
};

export function normalizeTagLabel(value: string): NormalizedTagLabel | null {
  const label = value.trim().replace(/\s+/g, " ");
  if (label.length === 0) {
    return null;
  }

  return {
    label,
    labelNormalized: label.toLocaleLowerCase("en-US"),
  };
}
