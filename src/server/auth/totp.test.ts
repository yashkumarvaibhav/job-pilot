import { describe, expect, it } from "vitest";

import {
  createTotpSetup,
  generateTotpCode,
  verifyTotpCode,
} from "./totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("RFC 6238 TOTP", () => {
  it("matches the RFC SHA-1 test secret at 59 seconds", () => {
    const at = new Date(59_000);
    expect(generateTotpCode(RFC_SECRET, at)).toBe("287082");
    expect(verifyTotpCode(RFC_SECRET, "287082", at)).toBe(1);
  });

  it("accepts one adjacent counter and rejects malformed or distant codes", () => {
    const at = new Date(90_000);
    const previous = generateTotpCode(RFC_SECRET, new Date(60_000));
    const distant = generateTotpCode(RFC_SECRET, new Date(0));

    expect(verifyTotpCode(RFC_SECRET, previous, at)).toBe(2);
    expect(verifyTotpCode(RFC_SECRET, distant, at)).toBeNull();
    expect(verifyTotpCode(RFC_SECRET, "12345", at)).toBeNull();
    expect(verifyTotpCode(RFC_SECRET, "abcdef", at)).toBeNull();
  });

  it("creates a standard setup key and URI without embedding a password", () => {
    const setup = createTotpSetup(
      "owner_name",
      Buffer.from("12345678901234567890", "ascii"),
    );

    expect(setup.secret).toBe(RFC_SECRET);
    expect(setup.uri).toContain("otpauth://totp/");
    expect(setup.uri).toContain("secret=GEZDGNBVGY3TQOJQ");
    expect(new URL(setup.uri).searchParams.get("issuer")).toBe("Job Pilot");
    expect(setup.uri).not.toContain("password");
  });
});
