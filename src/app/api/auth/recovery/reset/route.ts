import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  PASSWORD_RESET_COMPLETE_MESSAGE,
  PASSWORD_RESET_FAILED_MESSAGE,
} from "@/lib/account";
import { resetPasswordWithToken } from "@/server/auth/account-lifecycle";
import { readPasswordReset } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readPasswordReset(request);
  const guard = guardAccountAttempt("recovery", request, null);
  if (guard.limited) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      {
        status: 429,
        headers: { "retry-after": String(guard.retryAfterSeconds) },
      },
    );
  }

  const reset = input
    ? await resetPasswordWithToken(
        getDatabase(),
        input.token,
        input.password,
      )
    : false;
  if (!reset) {
    guard.recordFailure();
    return NextResponse.json(
      { error: PASSWORD_RESET_FAILED_MESSAGE },
      { status: 400 },
    );
  }

  guard.recordSuccess();
  (await cookies()).delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true, message: PASSWORD_RESET_COMPLETE_MESSAGE });
}
