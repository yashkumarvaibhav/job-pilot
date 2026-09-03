export const SAVED_SEARCH_ENTITY_TYPES = [
  "contacts",
  "opportunities",
  "referrals",
] as const;

export type SavedSearchEntityType = (typeof SAVED_SEARCH_ENTITY_TYPES)[number];

const entityTypeValues = new Set<string>(SAVED_SEARCH_ENTITY_TYPES);

export function isSavedSearchEntityType(
  value: unknown,
): value is SavedSearchEntityType {
  return typeof value === "string" && entityTypeValues.has(value);
}

export const SAVED_SEARCH_LIST_PATH: Record<SavedSearchEntityType, string> = {
  contacts: "/contacts",
  opportunities: "/opportunities",
  referrals: "/referrals",
};

/**
 * Named filters §42 that the JP-0024 query engine can already express.
 * Apply Today and OAs still need stages or assessment lists that the list
 * filters cannot name, so they stay omitted. Stale Opportunities is live now
 * that built-in stale marks exist.
 */
export const SAVED_SEARCH_SEEDS = [
  { name: "Checking for Openings", entityType: "contacts" },
  { name: "Need Reply", entityType: "contacts" },
  { name: "Follow-ups", entityType: "contacts" },
  { name: "High Priority", entityType: "opportunities" },
  { name: "Referral Pending", entityType: "referrals" },
  { name: "Stale Opportunities", entityType: "opportunities", query: "stale=1" },
] as const satisfies readonly {
  name: string;
  entityType: SavedSearchEntityType;
  query?: string;
}[];

const WORKSPACE_QUERY_KEYS = new Set([
  "workspace",
  "workspaceid",
  "workspace_id",
  "workspace-id",
]);

export function normalizeSavedSearchName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > 80) {
    return null;
  }
  return name;
}

export function canonicalizeSavedSearchQuery(value: string): string {
  const raw = value.trim();
  const encoded = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(encoded);
  const kept = new URLSearchParams();
  for (const [key, item] of params.entries()) {
    if (WORKSPACE_QUERY_KEYS.has(key.toLocaleLowerCase("en-US"))) {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    kept.append(key, trimmed);
  }
  return kept.toString();
}

export function savedSearchHref(
  entityType: SavedSearchEntityType,
  query: string,
): string {
  const path = SAVED_SEARCH_LIST_PATH[entityType];
  return query.length > 0 ? `${path}?${query}` : path;
}

export function normalizePaletteQuery(value: string): string | null {
  const query = value.trim().replace(/\s+/g, " ");
  if (query.length === 0 || query.length > 80) {
    return null;
  }
  return query;
}

export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
