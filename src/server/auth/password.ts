import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/account";

const deriveKey = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Per-account scrypt with a unique salt (D-035). The stored value carries its
 * own parameters so raising the cost later does not invalidate existing rows.
 */
const ALGORITHM = "scrypt";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function isAcceptablePassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await deriveKey(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return false;
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelism)
  ) {
    return false;
  }

  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");

  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  try {
    const derived = await deriveKey(password, salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
    });

    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
