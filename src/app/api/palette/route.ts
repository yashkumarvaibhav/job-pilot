import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { loadPaletteCatalog } from "@/server/repos/palette";
import { paletteResponse } from "@/server/repos/saved-search-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q") ?? "";
  return NextResponse.json(
    paletteResponse(loadPaletteCatalog(getDatabase(), tenant, query)),
  );
}
