import { NextResponse } from "next/server";

import {
  ACCOUNT_MAIL_UNAVAILABLE_MESSAGE,
  VERIFICATION_REQUESTED_MESSAGE,
} from "@/lib/account";
import { requestEmailVerification } from "@/server/auth/account-lifecycle";
import { configuredAccountMailPort } from "@/server/auth/account-mail";
import { readEmail } from "@/server/auth/http";
import {
  guardAccountAttempt,
  RATE_LIMITED_MESSAGE,
} from "@/server/auth/rate-limit-guard";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readEmail(request);
  const guard = guardAccountAttempt("verification", request, input?.email);
  if (guard.limited) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      {
        status: 429,
        headers: { "retry-after": String(guard.retryAfterSeconds) },
      },
    );
  }

  const mail = configuredAccountMailPort();
  if (!mail) {
    return NextResponse.json(
      { error: ACCOUNT_MAIL_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  if (!input) {
    guard.recordFailure();
    return NextResponse.json({ error: VERIFICATION_REQUESTED_MESSAGE });
  }

  try {
    await requestEmailVerification(
      getDatabase(),
      input.email,
      mail,
      new URL(request.url).origin,
    );
  } catch {
    return NextResponse.json(
      { error: ACCOUNT_MAIL_UNAVAILABLE_MESSAGE },
      { status: 503 },
    );
  }
  guard.recordSuccess();
  return NextResponse.json({ ok: true, message: VERIFICATION_REQUESTED_MESSAGE });
}
