import { describe, expect, it } from "vitest";

import {
  SUGGESTED_TAG_LABELS,
  isTagEntityType,
  normalizeTagLabel,
} from "./tag";

describe("tag domain", () => {
  it("ships section 56 labels as suggestions, not a closed list", () => {
    expect(SUGGESTED_TAG_LABELS).toEqual([
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
    ]);
    expect(isTagEntityType("company")).toBe(true);
    expect(isTagEntityType("referral")).toBe(false);
  });

  it("treats casing and inner spacing as the same tag", () => {
    expect(normalizeTagLabel("  Dream   Company ")).toEqual({
      label: "Dream Company",
      labelNormalized: "dream company",
    });
    expect(normalizeTagLabel("dream company")?.labelNormalized).toBe(
      normalizeTagLabel("Dream Company")?.labelNormalized,
    );
    expect(normalizeTagLabel("   ")).toBeNull();
  });
});
