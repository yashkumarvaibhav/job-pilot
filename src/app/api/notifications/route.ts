import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { notificationResponse } from "@/server/repos/notification-http";
import {
  countUnreadNotifications,
  listNotifications,
  parseNotificationTab,
} from "@/server/repos/notifications";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const tab = parseNotificationTab(
    new URL(request.url).searchParams.get("tab"),
  );
  const database = getDatabase();
  const items = listNotifications(database, tenant, tab);
  return NextResponse.json({
    tab,
    unreadCount: countUnreadNotifications(database, tenant),
    items: items.map(notificationResponse),
  });
}
