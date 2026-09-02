import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  notificationResponse,
  readIdsInput,
} from "@/server/repos/notification-http";
import {
  dismissNotifications,
  requestForbidsNotificationWrites,
} from "@/server/repos/notifications";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "Choose notifications to dismiss." };
const PREFETCH_FORBIDDEN = { error: "Prefetch cannot change notifications." };
const NOT_FOUND = { error: "Notification not found" };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  if (requestForbidsNotificationWrites(request)) {
    return NextResponse.json(PREFETCH_FORBIDDEN, { status: 403 });
  }
  const input = await readIdsInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  const rows = dismissNotifications(getDatabase(), tenant, input.ids);
  if (rows.length === 0) {
    return NextResponse.json(NOT_FOUND, { status: 404 });
  }
  return NextResponse.json(
    rows.map((row) => notificationResponse({ ...row, muted: false })),
  );
}
