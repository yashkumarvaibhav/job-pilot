import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { savedSearchResponse } from "@/server/repos/saved-search-http";
import {
  deleteSavedSearch,
  getSavedSearch,
} from "@/server/repos/saved-searches";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const SEARCH_NOT_FOUND = { error: "Saved search not found" };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  const row = getSavedSearch(getDatabase(), tenant, id);
  return row
    ? NextResponse.json(savedSearchResponse(row))
    : NextResponse.json(SEARCH_NOT_FOUND, { status: 404 });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const { id } = await context.params;
  return deleteSavedSearch(getDatabase(), tenant, id)
    ? new Response(null, { status: 204 })
    : NextResponse.json(SEARCH_NOT_FOUND, { status: 404 });
}
