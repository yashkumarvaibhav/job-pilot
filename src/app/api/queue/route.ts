import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listQueueSummaries } from "@/server/repos/send-safety";

export const runtime = "nodejs";

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json(listQueueSummaries(getDatabase(), tenant));
}
