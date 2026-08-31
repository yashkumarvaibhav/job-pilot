import { NextResponse } from "next/server";

import { authenticateAccount } from "@/server/auth/accounts";
import { establishSession } from "@/server/auth/current-session";
import { LOGIN_FAILED_MESSAGE, readCredentials } from "@/server/auth/http";
import { getDatabase } from "@/server/db/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const credentials = await readCredentials(request);
  const account = credentials
    ? await authenticateAccount(getDatabase(), credentials)
    : null;

  if (!account) {
    return NextResponse.json({ error: LOGIN_FAILED_MESSAGE }, { status: 401 });
  }

  await establishSession(account.userId);

  return NextResponse.json({ ok: true });
}
