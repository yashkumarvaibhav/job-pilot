import { randomBytes } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import type { AppDatabase } from "../db/client";
import { createAccountFoundation } from "../db/foundation";
import { userAccount } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { normalizeEmail } from "./email";
import { hashPassword, isAcceptablePassword, verifyPassword } from "./password";

export type RegisterAccountInput = {
  email: string;
  password: string;
  displayName?: string;
  timezone?: string;
  now?: Date;
  /** Omit for verified fixtures; public signup passes null until link use. */
  emailVerifiedAt?: Date | null;
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
  const emailNormalized = normalizeEmail(input.email);

  if (emailNormalized === null || !isAcceptablePassword(input.password)) {
    return REJECTED;
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const { tenant } = createAccountFoundation(database, {
      emailNormalized,
      passwordHash,
      displayName: input.displayName,
      timezone: input.timezone,
      now: input.now,
      emailVerifiedAt: input.emailVerifiedAt,
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
  email: string;
  password: string;
};

let decoyHash: Promise<string> | null = null;

/**
 * An unknown address still pays for one derivation, so a missing account and a
 * wrong password cost the same wall-clock time.
 */
function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return decoyHash;
}

export async function authenticateAccount(
  database: AppDatabase,
  input: AuthenticateAccountInput,
): Promise<{ userId: string } | null> {
  const emailNormalized = normalizeEmail(input.email);
  const account =
    emailNormalized === null
      ? undefined
      : database
          .select({
            id: userAccount.id,
            passwordHash: userAccount.passwordHash,
          })
          .from(userAccount)
          .where(
            and(
              eq(userAccount.emailNormalized, emailNormalized),
              eq(userAccount.status, "active"),
              isNotNull(userAccount.emailVerifiedAt),
            ),
          )
          .get();

  const matches = await verifyPassword(
    input.password,
    account?.passwordHash ?? (await decoy()),
  );

  return account && matches ? { userId: account.id } : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT")
  );
}
