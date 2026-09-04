import { describe, expect, it } from "vitest";

import { normalizeAccountIdentifier, normalizeUsername } from "./username";

describe("account usernames", () => {
  it("normalizes the public username grammar case-insensitively", () => {
    expect(normalizeUsername("  Owner.Check_7  ")).toBe("owner.check_7");
    expect(normalizeUsername("abc")).toBe("abc");
    expect(normalizeUsername("a".repeat(32))).toBe("a".repeat(32));
  });

  it.each([
    "ab",
    "a".repeat(33),
    "owner@example.com",
    "-owner",
    "owner-",
    "owner name",
    "owner/name",
    "सिद्धार्थ",
  ])("rejects a new public username outside the contract: %s", (value) => {
    expect(normalizeUsername(value)).toBeNull();
  });

  it("accepts grandfathered email-shaped identifiers only for login migration", () => {
    expect(normalizeAccountIdentifier(" Legacy@Invalid.Test ")).toBe(
      "legacy@invalid.test",
    );
    expect(normalizeAccountIdentifier("owner_name")).toBe("owner_name");
    expect(normalizeAccountIdentifier("owner name")).toBeNull();
    expect(normalizeAccountIdentifier("a".repeat(255))).toBeNull();
  });
});
