import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { digestPreviewResponse } from "@/server/repos/digest-http";
import { readDigestPreview } from "@/server/repos/digest";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json(
    digestPreviewResponse(readDigestPreview(getDatabase(), tenant)),
  );
}
