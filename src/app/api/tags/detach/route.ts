import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readDetachTagInput } from "@/server/repos/tag-http";
import { detachTag } from "@/server/repos/tags";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_TAG = { error: "Choose a tag and a record." };
const LINK_NOT_FOUND = { error: "Tag is not on that record" };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readDetachTagInput(request);
  if (!input) {
    return NextResponse.json(INVALID_TAG, { status: 400 });
  }

  return detachTag(getDatabase(), tenant, input)
    ? new Response(null, { status: 204 })
    : NextResponse.json(LINK_NOT_FOUND, { status: 404 });
}
