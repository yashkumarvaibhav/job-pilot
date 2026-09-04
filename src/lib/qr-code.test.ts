import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeQrCode } from "./qr-code";

const AUTHENTICATOR_URI =
  "otpauth://totp/Job%20Pilot%3Aowner_name?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot";

describe("encodeQrCode", () => {
  it("matches an independent byte-mode medium-correction reference matrix", () => {
    const matrix = encodeQrCode(AUTHENTICATOR_URI);
    const serialized = matrix
      .map((row) => row.map((module) => (module ? "1" : "0")).join(""))
      .join("\n");

    expect(matrix).toHaveLength(41);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(
      "55bddab81d858e4f8b9d648c7aeca43ca2ccf3109ebca0a1221609b62b570e51",
    );
  });

  it("is deterministic and rejects content outside its bounded capacity", () => {
    expect(encodeQrCode(AUTHENTICATOR_URI)).toEqual(
      encodeQrCode(AUTHENTICATOR_URI),
    );
    expect(() => encodeQrCode("x".repeat(214))).toThrow(
      "QR code content is too long.",
    );
  });
});
