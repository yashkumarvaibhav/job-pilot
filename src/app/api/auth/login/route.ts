import { NextResponse } from "next/server";

import { LOGIN_FAILED_MESSAGE } from "@/lib/account";
import { authenticateAccount } from "@/server/auth/accounts";
import { establishSession } from "@/server/auth/current-session";
import { readCredentials } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const credentials = await readCredentials(request);
  const guard = guardAccountAttempt("login", request, credentials?.username);

  if (guard.limited) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      {
        status: 429,
        headers: { "retry-after": String(guard.retryAfterSeconds) },
      },
    );
  }

  const account = credentials
    ? await authenticateAccount(getDatabase(), credentials)
    : null;

  if (!account) {
    guard.recordFailure();
    return NextResponse.json({ error: LOGIN_FAILED_MESSAGE }, { status: 401 });
  }

  guard.recordSuccess();
  await establishSession(account.userId);

  return NextResponse.json({
    ok: true,
    ...(account.signupComplete ? {} : { redirect: "/?auth=setup-totp" }),
  });
}
