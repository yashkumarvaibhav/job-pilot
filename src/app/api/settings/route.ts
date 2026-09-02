import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  readSettingsInput,
  settingsResponse,
} from "@/server/repos/settings-http";
import {
  SettingsInputError,
  readWorkspaceSettings,
  updateWorkspaceSettings,
} from "@/server/repos/settings";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID = { error: "Settings accept a name, university, timezone and quiet hours." };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json(
    settingsResponse(readWorkspaceSettings(getDatabase(), tenant)),
  );
}

export async function PATCH(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readSettingsInput(request);
  if (!input) {
    return NextResponse.json(INVALID, { status: 400 });
  }

  try {
    const saved = updateWorkspaceSettings(getDatabase(), tenant, {
      displayName: input.displayName,
      university: input.university,
      timezone: input.timezone,
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
    });
    return NextResponse.json(settingsResponse(saved));
  } catch (error) {
    if (error instanceof SettingsInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
