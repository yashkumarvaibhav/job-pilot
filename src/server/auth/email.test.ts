import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases so login identity is stable", () => {
    expect(normalizeEmail("  Owner@Invalid.TEST  ")).toBe("owner@invalid.test");
  });

  it("keeps the local part otherwise untouched", () => {
    expect(normalizeEmail("first.last+jobs@invalid.test")).toBe(
      "first.last+jobs@invalid.test",
    );
  });

  it("strips a pasted trailing newline rather than rejecting it", () => {
    expect(normalizeEmail("owner@invalid.test\n")).toBe("owner@invalid.test");
  });

  it("rejects shapes that cannot be an address", () => {
    for (const candidate of [
      "",
      "   ",
      "owner",
      "owner@",
      "@invalid.test",
      "owner@invalid",
      "owner invalid@invalid.test",
      "owner@@invalid.test",
      "owner@inv\nalid.test",
      `${"a".repeat(250)}@invalid.test`,
    ]) {
      expect(normalizeEmail(candidate), candidate).toBeNull();
    }
  });
});
