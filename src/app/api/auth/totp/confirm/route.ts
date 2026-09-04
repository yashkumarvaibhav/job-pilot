import { NextResponse } from "next/server";

import { TOTP_CONFIRM_FAILED_MESSAGE } from "@/lib/account";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { confirmTotpEnrollment } from "@/server/auth/account-security";
import { currentTotpEnrollmentTenant } from "@/server/auth/current-session";
import { readTotpCode } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const tenant = await currentTotpEnrollmentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const input = await readTotpCode(request);
  const guard = guardAccountAttempt("verification", request, tenant.userId);
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
  const confirmed = input && tokenKey
    ? confirmTotpEnrollment(getDatabase(), tenant, input.code, { tokenKey })
    : false;
  if (!confirmed) {
    guard.recordFailure();
    return NextResponse.json({ error: TOTP_CONFIRM_FAILED_MESSAGE }, { status: 400 });
  }
  guard.recordSuccess();
  return NextResponse.json({
    ok: true,
    message: "Authenticator enabled.",
    redirect: "/today",
  });
}
