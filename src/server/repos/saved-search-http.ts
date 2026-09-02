import {
  canonicalizeSavedSearchQuery,
  isSavedSearchEntityType,
  savedSearchHref,
  type SavedSearchEntityType,
} from "../../domain/saved-search";
import type { SavedSearch } from "./saved-searches";
import type {
  PaletteCompanyHit,
  PaletteContactHit,
  PaletteOpportunityHit,
} from "./palette";

export type SaveSearchBody = {
  name: string;
  entityType: SavedSearchEntityType;
  query?: string;
};

async function readObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return null;
  }
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function readSaveSearchInput(
  request: Request,
): Promise<SaveSearchBody | null> {
  const body = await readObject(request);
  if (
    !body ||
    typeof body.name !== "string" ||
    !isSavedSearchEntityType(body.entityType)
  ) {
    return null;
  }
  return {
    name: body.name,
    entityType: body.entityType,
    query:
      typeof body.query === "string"
        ? canonicalizeSavedSearchQuery(body.query)
        : "",
  };
}

export function savedSearchResponse(row: SavedSearch) {
  return {
    id: row.id,
    name: row.name,
    entityType: row.entityType,
    query: row.query,
    href: savedSearchHref(row.entityType, row.query),
  };
}

export function paletteResponse(input: {
  companies: PaletteCompanyHit[];
  contacts: PaletteContactHit[];
  opportunities: PaletteOpportunityHit[];
  savedSearches: SavedSearch[];
}) {
  return {
    companies: input.companies.map((row) => ({ id: row.id, name: row.name })),
    contacts: input.contacts.map((row) => ({ id: row.id, name: row.name })),
    opportunities: input.opportunities.map((row) => ({
      id: row.id,
      role: row.role,
      companyName: row.companyName,
    })),
    savedSearches: input.savedSearches.map(savedSearchResponse),
  };
}
