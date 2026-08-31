import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { AppDatabase } from "../db/client";
import { authSession, workspace } from "../db/schema";
import { createTenantContext, type TenantContext } from "../db/tenant";

export const SESSION_COOKIE_NAME = "job_pilot_session";

/** 256 bits of opacity: the cookie carries no identity of its own (D-035). */
const TOKEN_BYTES = 32;

export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1_000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1_000;

export type StartedSession = {
  sessionId: string;
  token: string;
  expiresAt: Date;
};

export type StartSessionOptions = {
  previousToken?: string | null;
  now?: Date;
};

function digestOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Login always mints a fresh value and retires the one the browser presented,
 * so a token captured before sign-in cannot survive it. Sessions belonging to
 * the account's other devices are untouched.
 */
export function startSession(
  database: AppDatabase,
  userId: string,
  options: StartSessionOptions = {},
): StartedSession {
  const now = options.now ?? new Date();
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const sessionId = randomUUID();
  const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_MS);
  const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);

  database.transaction((transaction) => {
    if (options.previousToken) {
      transaction
        .update(authSession)
        .set({ revokedAt: now })
        .where(
          and(
            eq(authSession.tokenDigest, digestOf(options.previousToken)),
            isNull(authSession.revokedAt),
          ),
        )
        .run();
    }

    transaction
      .insert(authSession)
      .values({
        id: sessionId,
        userId,
        tokenDigest: digestOf(token),
        createdAt: now,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
      })
      .run();
  });

  return { sessionId, token, expiresAt: idleExpiresAt };
}

/**
 * The only path from a bearer value to authority. The workspace comes from the
 * stored row, so no cookie, form field or URL can select a different tenant.
 */
export function resolveSessionTenant(
  database: AppDatabase,
  token: string | undefined | null,
  now: Date = new Date(),
): TenantContext | null {
  if (!token) {
    return null;
  }

  const row = database
    .select({
      userId: authSession.userId,
      workspaceId: workspace.id,
    })
    .from(authSession)
    .innerJoin(workspace, eq(workspace.ownerUserId, authSession.userId))
    .where(
      and(
        eq(authSession.tokenDigest, digestOf(token)),
        isNull(authSession.revokedAt),
        gt(authSession.idleExpiresAt, now),
        gt(authSession.absoluteExpiresAt, now),
      ),
    )
    .get();

  return row ? createTenantContext(row.userId, row.workspaceId) : null;
}

export function revokeSession(
  database: AppDatabase,
  token: string | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!token) {
    return false;
  }

  const revoked = database
    .update(authSession)
    .set({ revokedAt: now })
    .where(
      and(
        eq(authSession.tokenDigest, digestOf(token)),
        isNull(authSession.revokedAt),
      ),
    )
    .run();

  return revoked.changes > 0;
}

export type SessionCookieAttributes = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  expires: Date;
};

export function sessionCookieAttributes(options: {
  secure: boolean;
  expires: Date;
}): SessionCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: options.secure,
    expires: options.expires,
  };
}
