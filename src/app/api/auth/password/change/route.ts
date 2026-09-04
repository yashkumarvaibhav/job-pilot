import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  PASSWORD_CHANGE_COMPLETE_MESSAGE,
  PASSWORD_CHANGE_FAILED_MESSAGE,
} from "@/lib/account";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { changePasswordWithTotp } from "@/server/auth/account-security";
import { currentTenant } from "@/server/auth/current-session";
import { readTotpPasswordChange } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const input = await readTotpPasswordChange(request);
  const guard = guardAccountAttempt("recovery", request, tenant.userId);
  if (guard.limited) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      {
        status: 429,
        headers: { "retry-after": String(guard.retryAfterSeconds) },
      },
    );
  }
  const tokenKey = configuredAccountSecretKey();
  const changed = input && tokenKey
    ? await changePasswordWithTotp(getDatabase(), tenant, input, { tokenKey })
    : false;
  if (!changed) {
    guard.recordFailure();
    return NextResponse.json(
      { error: PASSWORD_CHANGE_FAILED_MESSAGE },
      { status: 400 },
    );
  }
  guard.recordSuccess();
  (await cookies()).delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true, message: PASSWORD_CHANGE_COMPLETE_MESSAGE });
}
