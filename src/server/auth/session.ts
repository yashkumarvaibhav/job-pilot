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

/**
 * How stale last-seen must be before a request writes. The idle window has to
 * slide or an active session dies mid-use, but a page load should stay a read;
 * once an hour keeps the guarantee and the cost apart.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1_000;

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

/**
 * Extend an in-use session's idle window, clamped to the absolute deadline it
 * was born with. Returns whether it actually wrote, so callers can tell an
 * ordinary read from a refresh. An expired or revoked session is never revived.
 */
export function touchSession(
  database: AppDatabase,
  token: string | undefined | null,
  now: Date = new Date(),
): boolean {
  if (!token) {
    return false;
  }

  const row = database
    .select({
      id: authSession.id,
      lastSeenAt: authSession.lastSeenAt,
      absoluteExpiresAt: authSession.absoluteExpiresAt,
    })
    .from(authSession)
    .where(
      and(
        eq(authSession.tokenDigest, digestOf(token)),
        isNull(authSession.revokedAt),
        gt(authSession.idleExpiresAt, now),
        gt(authSession.absoluteExpiresAt, now),
      ),
    )
    .get();
  if (!row) {
    return false;
  }
  if (now.getTime() - row.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) {
    return false;
  }

  const idleExpiresAt = new Date(
    Math.min(
      now.getTime() + SESSION_IDLE_MS,
      row.absoluteExpiresAt.getTime(),
    ),
  );

  database
    .update(authSession)
    .set({ lastSeenAt: now, idleExpiresAt })
    .where(eq(authSession.id, row.id))
    .run();

  return true;
}

/**
 * Every device signed out at once — what a password change or reset owes the
 * account. `exceptToken` keeps the session performing the change, so changing a
 * password in one tab does not sign that tab out too.
 */
export function revokeAllSessionsForUser(
  database: AppDatabase,
  userId: string,
  now: Date = new Date(),
  options: { exceptToken?: string | null } = {},
): number {
  const live = database
    .select({ id: authSession.id, tokenDigest: authSession.tokenDigest })
    .from(authSession)
    .where(and(eq(authSession.userId, userId), isNull(authSession.revokedAt)))
    .all();

  const keep = options.exceptToken ? digestOf(options.exceptToken) : null;
  const doomed = live.filter((row) => row.tokenDigest !== keep);
  let revoked = 0;
  for (const row of doomed) {
    revoked += database
      .update(authSession)
      .set({ revokedAt: now })
      .where(and(eq(authSession.id, row.id), isNull(authSession.revokedAt)))
      .run().changes;
  }

  return revoked;
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

/** Secure is on wherever the app is actually served over TLS (§62). */
export function sessionCookieIsSecure(
  nodeEnv: string | undefined = process.env.NODE_ENV,
  request: { host?: string | null; proto?: string | null } = {},
): boolean {
  const proto = request.proto?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (proto === "https") {
    return true;
  }
  if (proto === "http") {
    return false;
  }
  const host = (request.host ?? "").split(":")[0].toLowerCase();
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    return false;
  }
  return nodeEnv === "production";
}

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
