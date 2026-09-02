import { NextResponse } from "next/server";

import { isSavedSearchEntityType } from "@/domain/saved-search";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  readSaveSearchInput,
  savedSearchResponse,
} from "@/server/repos/saved-search-http";
import {
  SavedSearchInputError,
  listSavedSearches,
  saveSavedSearch,
} from "@/server/repos/saved-searches";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_SEARCH = { error: "Enter a name and choose a list." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const entityType = new URL(request.url).searchParams.get("entityType");
  if (entityType && !isSavedSearchEntityType(entityType)) {
    return NextResponse.json(INVALID_SEARCH, { status: 400 });
  }

  return NextResponse.json(
    listSavedSearches(
      getDatabase(),
      tenant,
      entityType && isSavedSearchEntityType(entityType) ? entityType : undefined,
    ).map(savedSearchResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }

  const input = await readSaveSearchInput(request);
  if (!input) {
    return NextResponse.json(INVALID_SEARCH, { status: 400 });
  }

  try {
    return NextResponse.json(
      savedSearchResponse(saveSavedSearch(getDatabase(), tenant, input)),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SavedSearchInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
