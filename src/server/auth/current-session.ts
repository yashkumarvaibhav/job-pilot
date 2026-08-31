import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "../db/runtime";
import type { TenantContext } from "../db/tenant";
import {
  resolveSessionTenant,
  revokeSession,
  SESSION_COOKIE_NAME,
  sessionCookieAttributes,
  startSession,
} from "./session";

export const LOGIN_PATH = "/login";

function cookieIsSecure(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

/** The single place a request turns into workspace authority (D-035). */
export async function currentTenant(): Promise<TenantContext | null> {
  return resolveSessionTenant(getDatabase(), await readSessionToken());
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
  const session = startSession(getDatabase(), userId, {
    previousToken: jar.get(SESSION_COOKIE_NAME)?.value ?? null,
  });

  jar.set(
    SESSION_COOKIE_NAME,
    session.token,
    sessionCookieAttributes({
      secure: cookieIsSecure(),
      expires: session.expiresAt,
    }),
  );
}

export async function endSession(): Promise<void> {
  const jar = await cookies();

  revokeSession(getDatabase(), jar.get(SESSION_COOKIE_NAME)?.value);
  jar.delete(SESSION_COOKIE_NAME);
}
