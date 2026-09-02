import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";

import type { RegisterAccountInput, RegisterAccountResult } from "./accounts";
import { registerAccount } from "./accounts";
import type { AccountMailPort } from "./account-mail";
import { normalizeEmail } from "./email";
import { hashPassword, isAcceptablePassword } from "./password";
import type { AppDatabase, AppTransaction } from "../db/client";
import { logEvent } from "../db/activity";
import { accountToken, authSession, userAccount, workspace } from "../db/schema";
import { createTenantContext } from "../db/tenant";

const TOKEN_BYTES = 32;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1_000;

type TokenPurpose = "verify_email" | "reset_password";

function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function issueToken(
  database: AppDatabase,
  userId: string,
  purpose: TokenPurpose,
  now: Date,
  ttlMs: number,
): { token: string; expiresAt: Date } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs);

  database.transaction((transaction) => {
    transaction
      .update(accountToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(accountToken.userId, userId),
          eq(accountToken.purpose, purpose),
          isNull(accountToken.usedAt),
        ),
      )
      .run();
    transaction
      .insert(accountToken)
      .values({
        id: randomUUID(),
        userId,
        purpose,
        tokenDigest: digestOf(token),
        expiresAt,
      })
      .run();
  });

  return { token, expiresAt };
}

function discardToken(database: AppDatabase, token: string): void {
  database
    .delete(accountToken)
    .where(eq(accountToken.tokenDigest, digestOf(token)))
    .run();
}

async function deliverVerification(
  database: AppDatabase,
  account: { id: string; emailNormalized: string },
  mail: AccountMailPort,
  origin: string,
  now: Date,
): Promise<void> {
  const issued = issueToken(
    database,
    account.id,
    "verify_email",
    now,
    EMAIL_VERIFICATION_TTL_MS,
  );
  try {
    await mail.sendVerification({
      recipient: account.emailNormalized,
      url: tokenUrl(origin, "/verify", issued.token),
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    discardToken(database, issued.token);
    throw error;
  }
}

export async function registerAccountWithVerification(
  database: AppDatabase,
  input: RegisterAccountInput,
  mail: AccountMailPort,
  origin: string,
): Promise<RegisterAccountResult> {
  const now = input.now ?? new Date();
  const created = await registerAccount(database, {
    ...input,
    now,
    emailVerifiedAt: null,
  });
  if (!created.ok) return created;

  const emailNormalized = normalizeEmail(input.email);
  if (!emailNormalized) return { ok: false };

  try {
    await deliverVerification(
      database,
      { id: created.tenant.userId, emailNormalized },
      mail,
      origin,
      now,
    );
    return created;
  } catch (error) {
    database
      .delete(userAccount)
      .where(eq(userAccount.id, created.tenant.userId))
      .run();
    throw error;
  }
}

export async function requestEmailVerification(
  database: AppDatabase,
  email: string,
  mail: AccountMailPort,
  origin: string,
  now: Date = new Date(),
): Promise<void> {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return;

  const account = database
    .select({ id: userAccount.id, emailNormalized: userAccount.emailNormalized })
    .from(userAccount)
    .where(
      and(
        eq(userAccount.emailNormalized, emailNormalized),
        eq(userAccount.status, "active"),
        isNull(userAccount.emailVerifiedAt),
      ),
    )
    .get();
  if (!account) return;

  await deliverVerification(database, account, mail, origin, now);
}

export async function requestPasswordReset(
  database: AppDatabase,
  email: string,
  mail: AccountMailPort,
  origin: string,
  now: Date = new Date(),
): Promise<void> {
  const emailNormalized = normalizeEmail(email);
  if (!emailNormalized) return;

  const account = database
    .select({ id: userAccount.id, emailNormalized: userAccount.emailNormalized })
    .from(userAccount)
    .where(
      and(
        eq(userAccount.emailNormalized, emailNormalized),
        eq(userAccount.status, "active"),
        isNotNull(userAccount.emailVerifiedAt),
      ),
    )
    .get();
  if (!account) return;

  const issued = issueToken(
    database,
    account.id,
    "reset_password",
    now,
    PASSWORD_RESET_TTL_MS,
  );
  try {
    await mail.sendPasswordReset({
      recipient: account.emailNormalized,
      url: tokenUrl(origin, "/reset-password", issued.token),
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    discardToken(database, issued.token);
    throw error;
  }
}

function liveToken(
  transaction: AppTransaction,
  rawToken: string,
  purpose: TokenPurpose,
  now: Date,
) {
  return transaction
    .select({
      id: accountToken.id,
      userId: accountToken.userId,
      workspaceId: workspace.id,
    })
    .from(accountToken)
    .innerJoin(userAccount, eq(userAccount.id, accountToken.userId))
    .innerJoin(workspace, eq(workspace.ownerUserId, userAccount.id))
    .where(
      and(
        eq(accountToken.tokenDigest, digestOf(rawToken)),
        eq(accountToken.purpose, purpose),
        isNull(accountToken.usedAt),
        gt(accountToken.expiresAt, now),
        eq(userAccount.status, "active"),
      ),
    )
    .get();
}

export function verifyEmailToken(
  database: AppDatabase,
  rawToken: string,
  now: Date = new Date(),
): boolean {
  if (!rawToken) return false;

  return database.transaction((transaction) => {
    const token = liveToken(transaction, rawToken, "verify_email", now);
    if (!token) return false;

    transaction
      .update(accountToken)
      .set({ usedAt: now })
      .where(and(eq(accountToken.id, token.id), isNull(accountToken.usedAt)))
      .run();
    transaction
      .update(userAccount)
      .set({ emailVerifiedAt: now, updatedAt: now })
      .where(eq(userAccount.id, token.userId))
      .run();
    logEvent(
      transaction,
      createTenantContext(token.userId, token.workspaceId),
      {
        at: now,
        kind: "ACCOUNT_EMAIL_VERIFIED",
        entityType: "user_account",
        entityId: token.userId,
      },
    );
    return true;
  });
}

export async function resetPasswordWithToken(
  database: AppDatabase,
  rawToken: string,
  password: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!rawToken || !isAcceptablePassword(password)) return false;
  const passwordHash = await hashPassword(password);

  return database.transaction((transaction) => {
    const token = liveToken(transaction, rawToken, "reset_password", now);
    if (!token) return false;

    transaction
      .update(userAccount)
      .set({ passwordHash, updatedAt: now })
      .where(eq(userAccount.id, token.userId))
      .run();
    transaction
      .update(accountToken)
      .set({ usedAt: now })
      .where(
        and(
          eq(accountToken.userId, token.userId),
          eq(accountToken.purpose, "reset_password"),
          isNull(accountToken.usedAt),
        ),
      )
      .run();
    transaction
      .update(authSession)
      .set({ revokedAt: now })
      .where(
        and(
          eq(authSession.userId, token.userId),
          isNull(authSession.revokedAt),
        ),
      )
      .run();
    logEvent(
      transaction,
      createTenantContext(token.userId, token.workspaceId),
      {
        at: now,
        kind: "ACCOUNT_PASSWORD_RESET",
        entityType: "user_account",
        entityId: token.userId,
      },
    );
    return true;
  });
}
