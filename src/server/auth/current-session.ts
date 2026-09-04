import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "../db/runtime";
import type { TenantContext } from "../db/tenant";
import {
  resolveSessionTenant,
  resolveEnrollmentSessionTenant,
  revokeSession,
  touchSession,
  SESSION_COOKIE_NAME,
  sessionCookieAttributes,
  sessionCookieIsSecure,
  startSession,
} from "./session";

export const LOGIN_PATH = "/login";

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

/** The single place a request turns into workspace authority (D-035). */
export async function currentTenant(): Promise<TenantContext | null> {
  const database = getDatabase();
  const token = await readSessionToken();
  const tenant = resolveSessionTenant(database, token);

  if (tenant) {
    // Keeps an in-use session from idling out mid-session; writes at most once
    // an hour and never past the absolute lifetime.
    touchSession(database, token);
  }

  return tenant;
}

/** Narrow authority for TOTP enrollment; it never opens workspace data APIs. */
export async function currentTotpEnrollmentTenant(): Promise<TenantContext | null> {
  const database = getDatabase();
  const token = await readSessionToken();
  const tenant =
    resolveSessionTenant(database, token) ??
    resolveEnrollmentSessionTenant(database, token);
  if (tenant) touchSession(database, token);
  return tenant;
}

export async function requireIncompleteSignupTenant(): Promise<TenantContext> {
  const database = getDatabase();
  const token = await readSessionToken();
  const tenant = resolveEnrollmentSessionTenant(database, token);
  if (!tenant) redirect(LOGIN_PATH);
  touchSession(database, token);
  return tenant;
}

export async function requireTenant(): Promise<TenantContext> {
  const tenant = await currentTenant();

  if (!tenant) {
    redirect(LOGIN_PATH);
  }

  return tenant;
}

/** Signs the account in and replaces whatever token the browser presented. */
export async function establishSession(userId: string): Promise<void> {
  const jar = await cookies();
  const headerList = await headers();
  const session = startSession(getDatabase(), userId, {
    previousToken: jar.get(SESSION_COOKIE_NAME)?.value ?? null,
  });

  jar.set(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieAttributes({
      secure: sessionCookieIsSecure(process.env.NODE_ENV, {
        host: headerList.get("host"),
        proto: headerList.get("x-forwarded-proto"),
      }),
      expires: session.expiresAt,
    }),
  );
}

export async function endSession(): Promise<void> {
  const jar = await cookies();

  revokeSession(getDatabase(), jar.get(SESSION_COOKIE_NAME)?.value);
  jar.delete(SESSION_COOKIE_NAME);
}
