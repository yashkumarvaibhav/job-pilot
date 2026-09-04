import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  ACCOUNT_SECURITY_UNAVAILABLE_MESSAGE,
  SIGNUP_FAILED_MESSAGE,
} from "@/lib/account";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { startTotpEnrollment } from "@/server/auth/account-security";
import { registerAccount } from "@/server/auth/accounts";
import { establishSession } from "@/server/auth/current-session";
import { readCredentials } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { getDatabase } from "@/server/db/runtime";
import { userAccount } from "@/server/db/schema";
import {
  DEMO_SIGNUP_CLOSED_MESSAGE,
  isDemoMode,
} from "@/server/demo-mode";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (isDemoMode()) {
    return NextResponse.json(
      { error: DEMO_SIGNUP_CLOSED_MESSAGE },
      { status: 403 },
    );
  }

  const credentials = await readCredentials(request);
  const guard = guardAccountAttempt("signup", request, credentials?.username);

  if (guard.limited) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      {
        status: 429,
        headers: { "retry-after": String(guard.retryAfterSeconds) },
      },
    );
  }

  if (!credentials) {
    guard.recordFailure();
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 400 });
  }

  const tokenKey = configuredAccountSecretKey();
  if (!tokenKey) {
    return NextResponse.json(
      { error: ACCOUNT_SECURITY_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  const database = getDatabase();
  const created = await registerAccount(database, {
    ...credentials,
    completeSignup: false,
  });
  if (!created.ok) {
    guard.recordFailure();
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 400 });
  }

  try {
    startTotpEnrollment(database, created.tenant, { tokenKey });
  } catch {
    database
      .delete(userAccount)
      .where(eq(userAccount.id, created.tenant.userId))
      .run();
    return NextResponse.json(
      { error: ACCOUNT_SECURITY_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  guard.recordSuccess();
  await establishSession(created.tenant.userId);
  return NextResponse.json(
    { ok: true, redirect: "/setup-totp" },
    { status: 201 },
  );
}
