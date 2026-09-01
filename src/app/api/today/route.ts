import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { todayResponse } from "@/server/repos/today-http";
import { getTodaySnapshot } from "@/server/repos/today";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  return NextResponse.json(
    todayResponse(getTodaySnapshot(getDatabase(), tenant)),
  );
}
