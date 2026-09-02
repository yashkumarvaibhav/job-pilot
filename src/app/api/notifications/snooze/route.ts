import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { readSnoozeInput } from "@/server/repos/notification-http";
import { notificationResponse } from "@/server/repos/notification-http";
import {
  NotificationInputError,
  requestForbidsNotificationWrites,
  resolveSnoozeUntil,
  snoozeNotifications,
} from "@/server/repos/notifications";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "Choose a snooze preset or a custom time." };
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
  const input = await readSnoozeInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  try {
    const until = resolveSnoozeUntil(input, new Date(), timeZone);
    const rows = snoozeNotifications(database, tenant, input.ids, until);
    if (rows.length === 0) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json(rows.map((row) => notificationResponse({ ...row, muted: false })));
  } catch (error) {
    if (error instanceof NotificationInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
