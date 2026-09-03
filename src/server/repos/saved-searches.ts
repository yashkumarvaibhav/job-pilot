import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import {
  SAVED_SEARCH_SEEDS,
  canonicalizeSavedSearchQuery,
  isSavedSearchEntityType,
  normalizeSavedSearchName,
  type SavedSearchEntityType,
} from "../../domain/saved-search";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import { savedSearch } from "../db/schema";
import type { TenantContext } from "../db/tenant";

export type SavedSearch = typeof savedSearch.$inferSelect;

export type SaveSearchInput = {
  id?: string;
  name: string;
  entityType: SavedSearchEntityType;
  query?: string;
  now?: Date;
};

export class SavedSearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedSearchInputError";
  }
}

function seedRows(tenant: TenantContext, now: Date) {
  return SAVED_SEARCH_SEEDS.map((seed) => ({
    id: randomUUID(),
    workspaceId: tenant.workspaceId,
    name: seed.name,
    entityType: seed.entityType,
    query: "query" in seed && seed.query ? seed.query : "",
    createdAt: now,
    updatedAt: now,
  }));
}

export function ensureSavedSearchSeeds(
  database: AppDatabase,
  tenant: TenantContext,
  now: Date = new Date(),
) {
  database
    .insert(savedSearch)
    .values(seedRows(tenant, now))
    .onConflictDoNothing({
      target: [savedSearch.workspaceId, savedSearch.name],
    })
    .run();
}

export function listSavedSearches(
  database: AppDatabase,
  tenant: TenantContext,
  entityType?: SavedSearchEntityType,
): SavedSearch[] {
  ensureSavedSearchSeeds(database, tenant);
  const conditions = [eq(savedSearch.workspaceId, tenant.workspaceId)];
  if (entityType) {
    conditions.push(eq(savedSearch.entityType, entityType));
  }
  return database
    .select()
    .from(savedSearch)
    .where(and(...conditions))
    .orderBy(asc(savedSearch.name), asc(savedSearch.id))
    .all();
}

export function getSavedSearch(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
): SavedSearch | undefined {
  return database
    .select()
    .from(savedSearch)
    .where(
      and(
        eq(savedSearch.workspaceId, tenant.workspaceId),
        eq(savedSearch.id, id),
      ),
    )
    .get();
}

export function saveSavedSearch(
  database: AppDatabase,
  tenant: TenantContext,
  input: SaveSearchInput,
): SavedSearch {
  const name = normalizeSavedSearchName(input.name);
  if (!name) {
    throw new SavedSearchInputError("Enter a name for this saved search.");
  }
  if (!isSavedSearchEntityType(input.entityType)) {
    throw new SavedSearchInputError("Choose a list this search belongs to.");
  }
  const query = canonicalizeSavedSearchQuery(input.query ?? "");
  const now = input.now ?? new Date();
  const id = input.id ?? randomUUID();

  return database.transaction((transaction) => {
    const row = transaction
      .insert(savedSearch)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        name,
        entityType: input.entityType,
        query,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [savedSearch.workspaceId, savedSearch.name],
        set: {
          entityType: input.entityType,
          query,
          updatedAt: now,
        },
      })
      .returning()
      .get();

    logEvent(transaction, tenant, {
      at: now,
      kind: "SAVED_SEARCH_SAVED",
      entityType: "saved_search",
      entityId: row.id,
      payload: { name: row.name, list: row.entityType },
    });
    return row;
  });
}

export function deleteSavedSearch(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  now: Date = new Date(),
): boolean {
  return database.transaction((transaction) => {
    const current = transaction
      .select()
      .from(savedSearch)
      .where(
        and(
          eq(savedSearch.workspaceId, tenant.workspaceId),
          eq(savedSearch.id, id),
        ),
      )
      .get();
    if (!current) {
      return false;
    }
    transaction
      .delete(savedSearch)
      .where(
        and(
          eq(savedSearch.workspaceId, tenant.workspaceId),
          eq(savedSearch.id, id),
        ),
      )
      .run();
    logEvent(transaction, tenant, {
      at: now,
      kind: "SAVED_SEARCH_DELETED",
      entityType: "saved_search",
      entityId: id,
      payload: { name: current.name },
    });
    return true;
  });
}
