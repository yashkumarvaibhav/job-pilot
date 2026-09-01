import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listActivity, parseActivityListFilter } from "@/server/repos/activity";
import { activityResponse } from "@/server/repos/activity-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const filter = parseActivityListFilter(
    new URL(request.url).searchParams,
    timeZone,
  );
  return NextResponse.json(
    listActivity(database, tenant, filter).map(activityResponse),
  );
}
