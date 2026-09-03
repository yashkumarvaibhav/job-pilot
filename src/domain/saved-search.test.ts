import { describe, expect, it } from "vitest";

import {
  SAVED_SEARCH_SEEDS,
  canonicalizeSavedSearchQuery,
  escapeLikePattern,
  isSavedSearchEntityType,
  normalizePaletteQuery,
  normalizeSavedSearchName,
  savedSearchHref,
} from "./saved-search";

describe("saved search domain", () => {
  it("accepts only list pages that already have a filter engine", () => {
    expect(isSavedSearchEntityType("opportunities")).toBe(true);
    expect(isSavedSearchEntityType("contacts")).toBe(true);
    expect(isSavedSearchEntityType("referrals")).toBe(true);
    expect(isSavedSearchEntityType("applications")).toBe(false);
    expect(isSavedSearchEntityType("workspace")).toBe(false);
  });

  it("seeds only the §42 names the current filters can express", () => {
    expect(SAVED_SEARCH_SEEDS.map((seed) => seed.name)).toEqual([
      "Checking for Openings",
      "Need Reply",
      "Follow-ups",
      "High Priority",
      "Referral Pending",
      "Stale Opportunities",
    ]);
    expect(SAVED_SEARCH_SEEDS.map((seed) => seed.name)).not.toContain(
      "Apply Today",
    );
    expect(SAVED_SEARCH_SEEDS.map((seed) => seed.name)).not.toContain("OAs");
  });

  it("stores the query string without workspace selectors", () => {
    expect(
      canonicalizeSavedSearchQuery(
        "?priority=High&workspace=other&company=microsoft",
      ),
    ).toBe("priority=High&company=microsoft");
    expect(canonicalizeSavedSearchQuery("workspaceId=abc")).toBe("");
    expect(canonicalizeSavedSearchQuery("")).toBe("");
  });

  it("restores a saved search as the list URL", () => {
    expect(savedSearchHref("opportunities", "priority=High")).toBe(
      "/opportunities?priority=High",
    );
    expect(savedSearchHref("contacts", "")).toBe("/contacts");
  });

  it("rejects a blank or oversized name", () => {
    expect(normalizeSavedSearchName("  High Priority  ")).toBe("High Priority");
    expect(normalizeSavedSearchName("")).toBeNull();
    expect(normalizeSavedSearchName("x".repeat(81))).toBeNull();
  });

  it("escapes LIKE wildcards so type-ahead cannot broaden a query", () => {
    expect(normalizePaletteQuery("  Rahul  ")).toBe("Rahul");
    expect(normalizePaletteQuery("")).toBeNull();
    expect(escapeLikePattern("100%_ok\\x")).toBe("100\\%\\_ok\\\\x");
  });
});
