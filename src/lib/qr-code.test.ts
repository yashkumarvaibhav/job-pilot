import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encodeQrCode } from "./qr-code";

const AUTHENTICATOR_URI =
  "otpauth://totp/Job%20Pilot%3Aowner_name?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot";
const PRODUCTION_LENGTH_AUTHENTICATOR_URI =
  "otpauth://totp/Job%20Pilot%3Aqrcheck_abcdefgh?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Job+Pilot&algorithm=SHA1&digits=6&period=30";

function hasAlignmentPattern(
  matrix: boolean[][],
  centerX: number,
  centerY: number,
): boolean {
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const distance = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      if (matrix[centerY + offsetY][centerX + offsetX] !== (distance !== 1)) {
        return false;
      }
    }
  }
  return true;
}

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

  it("places version 8 alignment patterns at their standard centers", () => {
    const matrix = encodeQrCode(PRODUCTION_LENGTH_AUTHENTICATOR_URI);

    expect(matrix).toHaveLength(49);
    expect(hasAlignmentPattern(matrix, 24, 24)).toBe(true);
    expect(hasAlignmentPattern(matrix, 42, 24)).toBe(true);
    expect(hasAlignmentPattern(matrix, 24, 42)).toBe(true);
    expect(hasAlignmentPattern(matrix, 42, 42)).toBe(true);
  });
});
