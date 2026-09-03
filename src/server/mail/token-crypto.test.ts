import { describe, expect, it } from "vitest";

import {
  decryptRefreshToken,
  encryptRefreshToken,
  TokenEncryptionError,
} from "./token-crypto";

const TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");

describe("refresh-token encryption", () => {
  it("round-trips a refresh token through a versioned AES-256-GCM envelope", () => {
    const encrypted = encryptRefreshToken("synthetic-refresh-token", TOKEN_KEY);

    expect(encrypted).not.toContain("synthetic-refresh-token");
    expect(JSON.parse(encrypted)).toMatchObject({ version: 1 });
    expect(decryptRefreshToken(encrypted, TOKEN_KEY)).toBe(
      "synthetic-refresh-token",
    );
  });

  it("uses a fresh nonce for every encryption", () => {
    expect(encryptRefreshToken("same-token", TOKEN_KEY)).not.toBe(
      encryptRefreshToken("same-token", TOKEN_KEY),
    );
  });

  it("fails closed for a wrong key or modified ciphertext", () => {
    const encrypted = encryptRefreshToken("synthetic-refresh-token", TOKEN_KEY);
    const envelope = JSON.parse(encrypted) as { ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`;

    expect(() =>
      decryptRefreshToken(
        encrypted,
        Buffer.alloc(32, 8).toString("base64"),
      ),
    ).toThrow(TokenEncryptionError);
    expect(() => decryptRefreshToken(JSON.stringify(envelope), TOKEN_KEY)).toThrow(
      TokenEncryptionError,
    );
  });

  it("rejects malformed keys without including secret material in the error", () => {
    expect(() => encryptRefreshToken("do-not-repeat", "short-key")).toThrow(
      "TOKEN_KEY must be a base64-encoded 32-byte key.",
    );

    try {
      encryptRefreshToken("do-not-repeat", "short-key");
    } catch (error) {
      expect(String(error)).not.toContain("do-not-repeat");
      expect(String(error)).not.toContain("short-key");
    }
  });
});
