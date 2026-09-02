import { NextResponse } from "next/server";

import { SIGNUP_FAILED_MESSAGE } from "@/lib/account";
import { registerAccount } from "@/server/auth/accounts";
import { establishSession } from "@/server/auth/current-session";
import { readCredentials } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { getDatabase } from "@/server/db/runtime";
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
  const guard = guardAccountAttempt("signup", request, credentials?.email);

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

  const created = await registerAccount(getDatabase(), credentials);

  if (!created.ok) {
    guard.recordFailure();
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 400 });
  }

  guard.recordSuccess();
  await establishSession(created.tenant.userId);

  return NextResponse.json({ ok: true });
}
