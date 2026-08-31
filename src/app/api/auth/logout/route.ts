import { NextResponse } from "next/server";

import { endSession } from "@/server/auth/current-session";

export const runtime = "nodejs";

/** Always succeeds: a missing or already-revoked session is still signed out. */
export async function POST() {
  await endSession();

  return NextResponse.json({ ok: true });
}
