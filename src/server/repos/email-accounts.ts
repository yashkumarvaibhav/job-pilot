import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { normalizeEmail } from "../auth/email";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import { emailAccount, settings } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import {
  decryptRefreshToken,
  encryptRefreshToken,
} from "../mail/token-crypto";

export type EmailAccountStatus = "connected" | "disconnected" | "error";

const REMOVED_TOKEN_BLOB = "credential-removed";

export type EmailAccountView = Omit<
  typeof emailAccount.$inferSelect,
  "googleSub" | "tokenBlob"
> & { isDefault: boolean };

export type ConnectEmailAccountInput = {
  googleSub: string;
  email: string;
  refreshToken: string;
  senderName?: string;
  signature?: string | null;
  replyTo?: string | null;
  dailyLimit?: number;
  sendingWindowStart?: number;
  sendingWindowEnd?: number;
  now?: Date;
};

export type UpdateEmailAccountSettingsInput = {
  senderName?: string;
  signature?: string | null;
  replyTo?: string | null;
  dailyLimit?: number;
  sendingWindowStart?: number;
  sendingWindowEnd?: number;
  now?: Date;
};

export class EmailAccountInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailAccountInputError";
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new EmailAccountInputError(`${label} is required.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function boundedText(
  value: string,
  label: string,
  maximum: number,
): string {
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new EmailAccountInputError(
      `${label} must be ${maximum} characters or fewer.`,
    );
  }
  return normalized;
}

function validEmail(value: string, label: string): string {
  const normalized = normalizeEmail(value);
  if (normalized === null) {
    throw new EmailAccountInputError(`${label} must be a valid email address.`);
  }
  return normalized;
}

function validLimit(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new EmailAccountInputError(
      "Daily limit must be a whole number from 1 to 500.",
    );
  }
  return value;
}

function validMinute(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new EmailAccountInputError(
      `${label} must be a whole minute from 0 to 1439.`,
    );
  }
  return value;
}

function toView(
  row: typeof emailAccount.$inferSelect,
  defaultEmailAccountId: string | null,
): EmailAccountView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    senderName: row.senderName,
    signature: row.signature,
    replyTo: row.replyTo,
    dailyLimit: row.dailyLimit,
    sendingWindowStart: row.sendingWindowStart,
    sendingWindowEnd: row.sendingWindowEnd,
    status: row.status,
    lastHistoryId: row.lastHistoryId,
    lastSyncAt: row.lastSyncAt,
    sequenceSafeAt: row.sequenceSafeAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDefault: row.id === defaultEmailAccountId,
  };
}

export function listEmailAccounts(
  database: AppDatabase,
  tenant: TenantContext,
): EmailAccountView[] {
  const defaultRow = database
    .select({ id: settings.defaultEmailAccountId })
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  return database
    .select()
    .from(emailAccount)
    .where(eq(emailAccount.workspaceId, tenant.workspaceId))
    .orderBy(asc(emailAccount.createdAt), asc(emailAccount.id))
    .all()
    .map((row) => toView(row, defaultRow?.id ?? null));
}

export function connectEmailAccount(
  database: AppDatabase,
  tenant: TenantContext,
  input: ConnectEmailAccountInput,
  tokenKey: string,
): EmailAccountView {
  const googleSub = requiredText(input.googleSub, "Google account id");
  const email = validEmail(input.email, "Gmail address");
  const refreshToken = requiredText(input.refreshToken, "Refresh token");
  const dailyLimit = validLimit(input.dailyLimit);
  const sendingWindowStart = validMinute(
    input.sendingWindowStart,
    "Sending window start",
  );
  const sendingWindowEnd = validMinute(
    input.sendingWindowEnd,
    "Sending window end",
  );
  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.googleSub, googleSub),
        ),
      )
      .get();
    const id = existing?.id ?? randomUUID();
    const tokenBlob = encryptRefreshToken(
      refreshToken,
      tokenKey,
      `${tenant.workspaceId}:${id}`,
    );

    const row = existing
      ? transaction
          .update(emailAccount)
          .set({
            email,
            tokenBlob,
            senderName:
              input.senderName === undefined
                ? existing.senderName
                : input.senderName.trim(),
            signature:
              input.signature === undefined
                ? existing.signature
                : optionalText(input.signature),
            replyTo:
              input.replyTo === undefined
                ? existing.replyTo
                : input.replyTo === null || input.replyTo.trim().length === 0
                  ? null
                  : validEmail(input.replyTo, "Reply-to"),
            dailyLimit: dailyLimit ?? existing.dailyLimit,
            sendingWindowStart:
              sendingWindowStart ?? existing.sendingWindowStart,
            sendingWindowEnd: sendingWindowEnd ?? existing.sendingWindowEnd,
            status: "connected",
            updatedAt: now,
          })
          .where(
            and(
              eq(emailAccount.workspaceId, tenant.workspaceId),
              eq(emailAccount.id, id),
            ),
          )
          .returning()
          .get()
      : transaction
          .insert(emailAccount)
          .values({
            id,
            workspaceId: tenant.workspaceId,
            googleSub,
            email,
            tokenBlob,
            senderName: input.senderName?.trim() ?? "",
            signature: optionalText(input.signature),
            replyTo:
              input.replyTo === undefined || input.replyTo === null
                ? null
                : validEmail(input.replyTo, "Reply-to"),
            dailyLimit,
            sendingWindowStart,
            sendingWindowEnd,
            status: "connected",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();

    logEvent(transaction, tenant, {
      at: now,
      kind: existing ? "EMAIL_ACCOUNT_RECONNECTED" : "EMAIL_ACCOUNT_CONNECTED",
      entityType: "email_account",
      entityId: id,
    });
    const defaultRow = transaction
      .select({ id: settings.defaultEmailAccountId })
      .from(settings)
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .get();
    return toView(row, defaultRow?.id ?? null);
  });
}

export function readEmailAccountRefreshToken(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  tokenKey: string,
): string | undefined {
  const row = database
    .select({ status: emailAccount.status, tokenBlob: emailAccount.tokenBlob })
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get();
  return row === undefined || row.status !== "connected"
    ? undefined
    : decryptRefreshToken(
        row.tokenBlob,
        tokenKey,
        `${tenant.workspaceId}:${accountId}`,
      );
}

export function readEmailAccountGoogleSubject(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
): string | undefined {
  return database
    .select({ googleSub: emailAccount.googleSub })
    .from(emailAccount)
    .where(
      and(
        eq(emailAccount.workspaceId, tenant.workspaceId),
        eq(emailAccount.id, accountId),
      ),
    )
    .get()?.googleSub;
}

export function updateEmailAccountSettings(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  input: UpdateEmailAccountSettingsInput,
): EmailAccountView | undefined {
  const now = input.now ?? new Date();
  const dailyLimit = validLimit(input.dailyLimit);
  const sendingWindowStart = validMinute(
    input.sendingWindowStart,
    "Sending window start",
  );
  const sendingWindowEnd = validMinute(
    input.sendingWindowEnd,
    "Sending window end",
  );

  return database.transaction((transaction) => {
    const existing = transaction
      .select()
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .get();
    if (!existing) {
      return undefined;
    }

    const row = transaction
      .update(emailAccount)
      .set({
        senderName:
          input.senderName === undefined
            ? existing.senderName
            : boundedText(input.senderName, "Sender name", 120),
        signature:
          input.signature === undefined
            ? existing.signature
            : input.signature === null
              ? null
              : boundedText(input.signature, "Signature", 10_000) || null,
        replyTo:
          input.replyTo === undefined
            ? existing.replyTo
            : input.replyTo === null || input.replyTo.trim().length === 0
              ? null
              : validEmail(input.replyTo, "Reply-to"),
        dailyLimit: dailyLimit ?? existing.dailyLimit,
        sendingWindowStart:
          sendingWindowStart ?? existing.sendingWindowStart,
        sendingWindowEnd: sendingWindowEnd ?? existing.sendingWindowEnd,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .returning()
      .get();
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_ACCOUNT_SETTINGS_UPDATED",
      entityType: "email_account",
      entityId: accountId,
      payload: {
        fields: Object.keys(input)
          .filter((key) => key !== "now")
          .sort(),
      },
    });
    const defaultRow = transaction
      .select({ id: settings.defaultEmailAccountId })
      .from(settings)
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .get();
    return toView(row, defaultRow?.id ?? null);
  });
}

export function setDefaultEmailAccount(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  now = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const owned = transaction
      .select({ id: emailAccount.id })
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
          eq(emailAccount.status, "connected"),
        ),
      )
      .get();
    if (!owned) {
      return false;
    }
    transaction
      .update(settings)
      .set({ defaultEmailAccountId: accountId })
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_ACCOUNT_DEFAULT_SET",
      entityType: "email_account",
      entityId: accountId,
    });
    return true;
  });
}

export function disconnectEmailAccount(
  database: AppDatabase,
  tenant: TenantContext,
  accountId: string,
  now = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const owned = transaction
      .select({ id: emailAccount.id })
      .from(emailAccount)
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .get();
    if (!owned) {
      return false;
    }
    transaction
      .update(settings)
      .set({ defaultEmailAccountId: null })
      .where(
        and(
          eq(settings.workspaceId, tenant.workspaceId),
          eq(settings.defaultEmailAccountId, accountId),
        ),
      )
      .run();
    transaction
      .update(emailAccount)
      .set({
        tokenBlob: REMOVED_TOKEN_BLOB,
        status: "disconnected",
        sequenceSafeAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(emailAccount.workspaceId, tenant.workspaceId),
          eq(emailAccount.id, accountId),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "EMAIL_ACCOUNT_DISCONNECTED",
      entityType: "email_account",
      entityId: accountId,
    });
    return true;
  });
}
