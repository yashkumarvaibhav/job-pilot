import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../db/client";
import { createAccountFoundation } from "../db/foundation";
import { userAccount } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { hashPassword, isAcceptablePassword, verifyPassword } from "./password";
import { normalizeAccountIdentifier, normalizeUsername } from "./username";

export type RegisterAccountInput = {
  username: string;
  password: string;
  displayName?: string;
  timezone?: string;
  now?: Date;
  completeSignup?: boolean;
};

/**
 * Signup reports one shape for every rejection. A distinct "already registered"
 * answer would turn the form into an address oracle (D-035, §62).
 */
export type RegisterAccountResult =
  | { ok: true; tenant: TenantContext }
  | { ok: false };

const REJECTED: RegisterAccountResult = { ok: false };

export async function registerAccount(
  database: AppDatabase,
  input: RegisterAccountInput,
): Promise<RegisterAccountResult> {
  const usernameNormalized = normalizeUsername(input.username);

  if (usernameNormalized === null || !isAcceptablePassword(input.password)) {
    return REJECTED;
  }

  const passwordHash = await hashPassword(input.password);
  const now = input.now ?? new Date();

  try {
    const { tenant } = createAccountFoundation(database, {
      usernameNormalized,
      passwordHash,
      displayName: input.displayName,
      timezone: input.timezone,
      now,
      signupCompletedAt: input.completeSignup === false ? null : now,
    });

    return { ok: true, tenant };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return REJECTED;
    }

    throw error;
  }
}

export type AuthenticateAccountInput = {
  username: string;
  password: string;
};

let decoyHash: Promise<string> | null = null;

/**
 * An unknown username still pays for one derivation, so a missing account and a
 * wrong password cost the same wall-clock time.
 */
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return decoyHash;
}

export async function authenticateAccount(
  database: AppDatabase,
  input: AuthenticateAccountInput,
): Promise<{ userId: string; signupComplete: boolean } | null> {
  const usernameNormalized = normalizeAccountIdentifier(input.username);
  const account =
    usernameNormalized === null
      ? undefined
      : database
          .select({
            id: userAccount.id,
            passwordHash: userAccount.passwordHash,
            signupCompletedAt: userAccount.signupCompletedAt,
          })
          .from(userAccount)
          .where(
            and(
              eq(userAccount.usernameNormalized, usernameNormalized),
              eq(userAccount.status, "active"),
            ),
          )
          .get();

  const matches = await verifyPassword(
    input.password,
    account?.passwordHash ?? (await decoy()),
  );

  return account && matches
    ? { userId: account.id, signupComplete: account.signupCompletedAt !== null }
    : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}
