import { describe, expect, it } from "vitest";

import {
  hashPassword,
  isAcceptablePassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from "./password";

describe("hashPassword", () => {
  it("encodes the algorithm, parameters, salt and derived key", async () => {
    const stored = await hashPassword("correct horse battery");
    const parts = stored.split("$");

    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384);
    expect(parts[4]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(parts[5]).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });

  it("salts every hash separately", async () => {
    const first = await hashPassword("correct horse battery");
    const second = await hashPassword("correct horse battery");

    expect(first).not.toBe(second);
    expect(first.split("$")[4]).not.toBe(second.split("$")[4]);
  });

  it("never contains the plaintext", async () => {
    const stored = await hashPassword("correct horse battery");

    expect(stored).not.toContain("correct horse battery");
  });
});

describe("verifyPassword", () => {
  it("accepts the original password", async () => {
    const stored = await hashPassword("correct horse battery");

    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(
      true,
    );
  });

  it("rejects a different password", async () => {
    const stored = await hashPassword("correct horse battery");

    await expect(verifyPassword("correct horse batteries", stored)).resolves.toBe(
      false,
    );
  });

  it("rejects a malformed stored value instead of throwing", async () => {
    await expect(verifyPassword("correct horse battery", "")).resolves.toBe(
      false,
    );
    await expect(
      verifyPassword("correct horse battery", "scrypt$16384$8$1$abc"),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("correct horse battery", "argon2$16384$8$1$abc$def"),
    ).resolves.toBe(false);
  });
});

describe("isAcceptablePassword", () => {
  it("requires the documented length window", () => {
    expect(isAcceptablePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isAcceptablePassword("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isAcceptablePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isAcceptablePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });
});
