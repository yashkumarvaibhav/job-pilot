import { NextResponse } from "next/server";

import {
  ACCOUNT_SECURITY_UNAVAILABLE_MESSAGE,
  TOTP_ALREADY_ENABLED_MESSAGE,
} from "@/lib/account";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { startTotpEnrollment } from "@/server/auth/account-security";
import { currentTotpEnrollmentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST() {
  const tenant = await currentTotpEnrollmentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const tokenKey = configuredAccountSecretKey();
  if (!tokenKey) {
    return NextResponse.json(
      { error: ACCOUNT_SECURITY_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  const setup = startTotpEnrollment(getDatabase(), tenant, { tokenKey });
  return setup
    ? NextResponse.json(setup)
    : NextResponse.json({ error: TOTP_ALREADY_ENABLED_MESSAGE }, { status: 409 });
}
