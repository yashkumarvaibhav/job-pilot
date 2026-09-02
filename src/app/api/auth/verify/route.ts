import { NextResponse } from "next/server";

import { VERIFICATION_FAILED_MESSAGE } from "@/lib/account";
import { verifyEmailToken } from "@/server/auth/account-lifecycle";
import { readToken } from "@/server/auth/http";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const input = await readToken(request);
  const verified = input
    ? verifyEmailToken(getDatabase(), input.token)
    : false;

  return verified
    ? NextResponse.json({ ok: true })
    : NextResponse.json(
        { error: VERIFICATION_FAILED_MESSAGE },
        { status: 400 },
      );
}
