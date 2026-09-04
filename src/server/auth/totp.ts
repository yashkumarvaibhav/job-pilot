import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const MODULUS = 10 ** DIGITS;

export type TotpSetup = {
  secret: string;
  uri: string;
};

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += ALPHABET[(value << (5 - bits)) & 31];
  return encoded;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.replace(/=+$/u, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function counterAt(at: Date): number {
  return Math.floor(at.getTime() / 1_000 / STEP_SECONDS);
}

function codeAtCounter(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % MODULUS).padStart(DIGITS, "0");
}

export function createTotpSetup(
  username: string,
  secretBytes: Buffer = randomBytes(20),
): TotpSetup {
  if (secretBytes.length < 20) throw new Error("A 160-bit TOTP secret is required.");
  const secret = encodeBase32(secretBytes);
  const label = encodeURIComponent(`Job Pilot:${username}`);
  const params = new URLSearchParams({
    secret,
    issuer: "Job Pilot",
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return { secret, uri: `otpauth://totp/${label}?${params.toString()}` };
}

export function generateTotpCode(secret: string, at: Date = new Date()): string {
  return codeAtCounter(secret, counterAt(at));
}

export function verifyTotpCode(
  secret: string,
  candidate: string,
  at: Date = new Date(),
): number | null {
  if (!/^\d{6}$/u.test(candidate)) return null;
  const supplied = Buffer.from(candidate, "ascii");
  const counter = counterAt(at);
  for (const offset of [-1, 0, 1]) {
    const expectedCounter = counter + offset;
    if (expectedCounter < 0) continue;
    const expected = Buffer.from(codeAtCounter(secret, expectedCounter), "ascii");
    if (timingSafeEqual(supplied, expected)) return expectedCounter;
  }
  return null;
}
