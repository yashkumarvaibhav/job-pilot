import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import type { AppDatabase, AppTransaction } from "../db/client";
import { logEvent } from "../db/activity";
import { authSession, userAccount, workspace } from "../db/schema";
import { createTenantContext, type TenantContext } from "../db/tenant";
import { hashPassword, isAcceptablePassword, verifyPassword } from "./password";
import { createTotpSetup, type TotpSetup, verifyTotpCode } from "./totp";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-secret";
import { normalizeAccountIdentifier } from "./username";

type SecurityOptions = {
  tokenKey: string;
  now?: Date;
};

type EnrollmentOptions = SecurityOptions & {
  secretBytes?: Buffer;
};

export type AccountSecurityView = {
  username: string;
  totpEnabled: boolean;
  setup: TotpSetup | null;
};

function accountForTenant(
  database: AppDatabase | AppTransaction,
  tenant: TenantContext,
) {
  return database
    .select({
      id: userAccount.id,
      username: userAccount.usernameNormalized,
      passwordHash: userAccount.passwordHash,
      totpSecretBlob: userAccount.totpSecretBlob,
      totpEnabledAt: userAccount.totpEnabledAt,
      totpLastUsedCounter: userAccount.totpLastUsedCounter,
      signupCompletedAt: userAccount.signupCompletedAt,
    })
    .from(userAccount)
    .innerJoin(workspace, eq(workspace.ownerUserId, userAccount.id))
    .where(
      and(
        eq(userAccount.id, tenant.userId),
        eq(workspace.id, tenant.workspaceId),
        eq(userAccount.status, "active"),
      ),
    )
    .get();
}

export function startTotpEnrollment(
  database: AppDatabase,
  tenant: TenantContext,
  options: EnrollmentOptions,
): TotpSetup | null {
  const account = accountForTenant(database, tenant);
  if (!account || account.totpEnabledAt) return null;

  const setup = createTotpSetup(account.username, options.secretBytes);
  const encrypted = encryptTotpSecret(
    setup.secret,
    options.tokenKey,
    account.id,
  );
  const changed = database
    .update(userAccount)
    .set({
      totpSecretBlob: encrypted,
      totpEnabledAt: null,
      totpLastUsedCounter: null,
      updatedAt: options.now ?? new Date(),
    })
    .where(
      and(
        eq(userAccount.id, tenant.userId),
        eq(userAccount.status, "active"),
        isNull(userAccount.totpEnabledAt),
      ),
    )
    .run();

  return changed.changes === 1 ? setup : null;
}

export function readAccountSecurity(
  database: AppDatabase,
  tenant: TenantContext,
  tokenKey: string | null,
): AccountSecurityView | null {
  const account = accountForTenant(database, tenant);
  if (!account) return null;
  const totpEnabled = account.totpEnabledAt !== null;
  const secret =
    !totpEnabled && account.totpSecretBlob && tokenKey
      ? decryptTotpSecret(account.totpSecretBlob, tokenKey, account.id)
      : null;

  return {
    username: account.username,
    totpEnabled,
    setup: secret ? createTotpSetup(account.username, decodeSetupSecret(secret)) : null,
  };
}

/** Convert a canonical base32 secret back to bytes so one URI builder owns copy. */
function decodeSetupSecret(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function confirmTotpEnrollment(
  database: AppDatabase,
  tenant: TenantContext,
  code: string,
  options: SecurityOptions,
): boolean {
  const account = accountForTenant(database, tenant);
  if (!account?.totpSecretBlob || account.totpEnabledAt) return false;
  const secretBlob = account.totpSecretBlob;
  const now = options.now ?? new Date();
  let secret: string;
  try {
    secret = decryptTotpSecret(secretBlob, options.tokenKey, account.id);
  } catch {
    return false;
  }
  if (verifyTotpCode(secret, code, now) === null) return false;

  return database.transaction((transaction) => {
    const changed = transaction
      .update(userAccount)
      .set({
        totpEnabledAt: now,
        signupCompletedAt: account.signupCompletedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(userAccount.id, account.id),
          eq(userAccount.totpSecretBlob, secretBlob),
          isNull(userAccount.totpEnabledAt),
        ),
      )
      .run();
    if (changed.changes !== 1) return false;
    logEvent(transaction, tenant, {
      at: now,
      kind: "ACCOUNT_TOTP_ENABLED",
      entityType: "user_account",
      entityId: account.id,
    });
    return true;
  });
}

type PasswordResetInput = {
  username: string;
  code: string;
  password: string;
};

type PasswordChangeInput = {
  currentPassword: string;
  code: string;
  newPassword: string;
};

function liveRecoveryAccount(database: AppDatabase, username: string) {
  return database
    .select({
      id: userAccount.id,
      workspaceId: workspace.id,
      passwordHash: userAccount.passwordHash,
      totpSecretBlob: userAccount.totpSecretBlob,
      totpLastUsedCounter: userAccount.totpLastUsedCounter,
    })
    .from(userAccount)
    .innerJoin(workspace, eq(workspace.ownerUserId, userAccount.id))
    .where(
      and(
        eq(userAccount.usernameNormalized, username),
        eq(userAccount.status, "active"),
        isNotNull(userAccount.totpEnabledAt),
        isNotNull(userAccount.totpSecretBlob),
      ),
    )
    .get();
}

function totpCounter(
  account: { id: string; totpSecretBlob: string | null },
  code: string,
  options: SecurityOptions,
): number | null {
  if (!account.totpSecretBlob) return null;
  try {
    return verifyTotpCode(
      decryptTotpSecret(account.totpSecretBlob, options.tokenKey, account.id),
      code,
      options.now ?? new Date(),
    );
  } catch {
    return null;
  }
}

function applyPassword(
  database: AppDatabase,
  account: {
    id: string;
    workspaceId: string;
    totpSecretBlob: string | null;
    totpLastUsedCounter: number | null;
  },
  passwordHash: string,
  counter: number,
  now: Date,
  kind: "ACCOUNT_PASSWORD_CHANGED" | "ACCOUNT_PASSWORD_RESET",
): boolean {
  if (!account.totpSecretBlob) return false;
  const secretBlob = account.totpSecretBlob;
  return database.transaction((transaction) => {
    const changed = transaction
      .update(userAccount)
      .set({
        passwordHash,
        totpLastUsedCounter: counter,
        updatedAt: now,
      })
      .where(
        and(
          eq(userAccount.id, account.id),
          eq(userAccount.totpSecretBlob, secretBlob),
          isNotNull(userAccount.totpEnabledAt),
          account.totpLastUsedCounter === null
            ? isNull(userAccount.totpLastUsedCounter)
            : or(
                isNull(userAccount.totpLastUsedCounter),
                lt(userAccount.totpLastUsedCounter, counter),
              ),
        ),
      )
      .run();
    if (changed.changes !== 1) return false;

    transaction
      .update(authSession)
      .set({ revokedAt: now })
      .where(
        and(eq(authSession.userId, account.id), isNull(authSession.revokedAt)),
      )
      .run();
    logEvent(
      transaction,
      createTenantContext(account.id, account.workspaceId),
      {
        at: now,
        kind,
        entityType: "user_account",
        entityId: account.id,
      },
    );
    return true;
  });
}

export async function resetPasswordWithTotp(
  database: AppDatabase,
  input: PasswordResetInput,
  options: SecurityOptions,
): Promise<boolean> {
  const username = normalizeAccountIdentifier(input.username);
  if (!username || !isAcceptablePassword(input.password)) return false;
  const passwordHash = await hashPassword(input.password);
  const account = liveRecoveryAccount(database, username);
  if (!account) return false;
  const counter = totpCounter(account, input.code, options);
  if (counter === null || (account.totpLastUsedCounter ?? -1) >= counter) {
    return false;
  }
  return applyPassword(
    database,
    account,
    passwordHash,
    counter,
    options.now ?? new Date(),
    "ACCOUNT_PASSWORD_RESET",
  );
}

export async function changePasswordWithTotp(
  database: AppDatabase,
  tenant: TenantContext,
  input: PasswordChangeInput,
  options: SecurityOptions,
): Promise<boolean> {
  if (!isAcceptablePassword(input.newPassword)) return false;
  const account = accountForTenant(database, tenant);
  if (!account?.totpSecretBlob || !account.totpEnabledAt) return false;
  const [currentMatches, passwordHash] = await Promise.all([
    verifyPassword(input.currentPassword, account.passwordHash),
    hashPassword(input.newPassword),
  ]);
  if (!currentMatches) return false;
  const counter = totpCounter(account, input.code, options);
  if (counter === null || (account.totpLastUsedCounter ?? -1) >= counter) {
    return false;
  }
  return applyPassword(
    database,
    { ...account, workspaceId: tenant.workspaceId },
    passwordHash,
    counter,
    options.now ?? new Date(),
    "ACCOUNT_PASSWORD_CHANGED",
  );
}
