import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readMuteInput } from "@/server/repos/notification-http";
import {
  muteNotificationKind,
  requestForbidsNotificationWrites,
} from "@/server/repos/notifications";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "Choose a notification type to mute." };
const PREFETCH_FORBIDDEN = { error: "Prefetch cannot change notifications." };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  if (requestForbidsNotificationWrites(request)) {
    return NextResponse.json(PREFETCH_FORBIDDEN, { status: 403 });
  }
  const input = await readMuteInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  const mutedKinds = muteNotificationKind(getDatabase(), tenant, input.kind);
  return NextResponse.json({ mutedKinds });
}
