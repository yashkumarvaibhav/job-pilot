import { NextResponse } from "next/server";

import { SIGNUP_FAILED_MESSAGE } from "@/lib/account";
import { registerAccount } from "@/server/auth/accounts";
import { establishSession } from "@/server/auth/current-session";
import { readCredentials } from "@/server/auth/http";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const credentials = await readCredentials(request);

  if (!credentials) {
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 400 });
  }

  const created = await registerAccount(getDatabase(), credentials);

  if (!created.ok) {
    return NextResponse.json({ error: SIGNUP_FAILED_MESSAGE }, { status: 400 });
  }

  await establishSession(created.tenant.userId);

  return NextResponse.json({ ok: true });
}
