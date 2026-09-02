import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  materializeNotifications,
  requestForbidsNotificationWrites,
} from "@/server/repos/notifications";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const PREFETCH_FORBIDDEN = { error: "Prefetch cannot change notifications." };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  if (requestForbidsNotificationWrites(request)) {
    return NextResponse.json(PREFETCH_FORBIDDEN, { status: 403 });
  }
  const result = materializeNotifications(getDatabase(), tenant);
  return NextResponse.json(result);
}
