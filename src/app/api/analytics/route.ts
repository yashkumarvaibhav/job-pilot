import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { analyticsResponse } from "@/server/repos/analytics-http";
import { getAnalyticsSnapshot } from "@/server/repos/analytics";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  return NextResponse.json(
    analyticsResponse(getAnalyticsSnapshot(getDatabase(), tenant)),
  );
}
