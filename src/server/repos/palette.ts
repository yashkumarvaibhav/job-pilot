import { and, asc, eq, or, sql } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  escapeLikePattern,
  normalizePaletteQuery,
} from "../../domain/saved-search";
import type { AppDatabase } from "../db/client";
import { company, contact, opportunity } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { listSavedSearches } from "./saved-searches";

export type PaletteCompanyHit = { id: string; name: string };
export type PaletteContactHit = { id: string; name: string };
export type PaletteOpportunityHit = {
  id: string;
  role: string;
  companyName: string;
};

export type PaletteSearchResult = {
  companies: PaletteCompanyHit[];
  contacts: PaletteContactHit[];
  opportunities: PaletteOpportunityHit[];
};

const HIT_LIMIT = 8;

function nameMatches(column: AnySQLiteColumn, query: string) {
  const pattern = `%${escapeLikePattern(query.toLocaleLowerCase("en-US"))}%`;
  return sql`lower(${column}) like ${pattern} escape char(92)`;
}

export function searchPaletteEntities(
  database: AppDatabase,
  tenant: TenantContext,
  rawQuery: string,
): PaletteSearchResult {
  const query = normalizePaletteQuery(rawQuery);
  if (!query) {
    return { companies: [], contacts: [], opportunities: [] };
  }

  const companies = database
    .select({ id: company.id, name: company.name })
    .from(company)
    .where(
      and(eq(company.workspaceId, tenant.workspaceId), nameMatches(company.name, query)),
    )
    .orderBy(asc(company.name), asc(company.id))
    .limit(HIT_LIMIT)
    .all();

  const contacts = database
    .select({ id: contact.id, name: contact.name })
    .from(contact)
    .where(
      and(eq(contact.workspaceId, tenant.workspaceId), nameMatches(contact.name, query)),
    )
    .orderBy(asc(contact.name), asc(contact.id))
    .limit(HIT_LIMIT)
    .all();

  const opportunities = database
    .select({
      id: opportunity.id,
      role: opportunity.role,
      companyName: company.name,
    })
    .from(opportunity)
    .innerJoin(
      company,
      and(
        eq(company.workspaceId, opportunity.workspaceId),
        eq(company.id, opportunity.companyId),
      ),
    )
    .where(
      and(
        eq(opportunity.workspaceId, tenant.workspaceId),
        or(
          nameMatches(opportunity.role, query),
          nameMatches(company.name, query),
        ),
      ),
    )
    .orderBy(asc(company.name), asc(opportunity.role), asc(opportunity.id))
    .limit(HIT_LIMIT)
    .all();

  return { companies, contacts, opportunities };
}

export function loadPaletteCatalog(
  database: AppDatabase,
  tenant: TenantContext,
  rawQuery: string,
) {
  return {
    ...searchPaletteEntities(database, tenant, rawQuery),
    savedSearches: listSavedSearches(database, tenant),
  };
}
