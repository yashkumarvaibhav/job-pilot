import { and, eq } from "drizzle-orm";

import {
  DUPLICATE_COMPANY_WARNING,
  DUPLICATE_JOB_WARNING,
  DuplicateConflictError,
  matchCompanySignals,
  matchOpportunitySignals,
  type CompanyDuplicateInput,
  type DuplicateCandidate,
  type OpportunityDuplicateInput,
} from "../../domain/duplicate";
import type { AppDatabase, AppTransaction } from "../db/client";
import { company, opportunity } from "../db/schema";
import type { TenantContext } from "../db/tenant";

type Database = AppDatabase | AppTransaction;

export function findCompanyDuplicateCandidates(
  database: Database,
  tenant: TenantContext,
  incoming: CompanyDuplicateInput,
): DuplicateCandidate[] {
  return database
    .select()
    .from(company)
    .where(eq(company.workspaceId, tenant.workspaceId))
    .all()
    .flatMap((row) => {
      const signals = matchCompanySignals(incoming, row);
      return signals.length === 0
        ? []
        : [
            {
              id: row.id,
              entityType: "company" as const,
              label: row.name,
              href: `/companies/${row.id}`,
              signals,
            },
          ];
    });
}

export function findOpportunityDuplicateCandidates(
  database: Database,
  tenant: TenantContext,
  incoming: OpportunityDuplicateInput,
): DuplicateCandidate[] {
  return database
    .select({
      id: opportunity.id,
      companyId: opportunity.companyId,
      role: opportunity.role,
      jobId: opportunity.jobId,
      url: opportunity.url,
      location: opportunity.location,
      postedOn: opportunity.postedOn,
      deadlineOn: opportunity.deadlineOn,
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
    .where(eq(opportunity.workspaceId, tenant.workspaceId))
    .all()
    .flatMap((row) => {
      const signals = matchOpportunitySignals(incoming, row);
      return signals.length === 0
        ? []
        : [
            {
              id: row.id,
              entityType: "opportunity" as const,
              label: `${row.companyName} · ${row.role}`,
              href: `/opportunities/${row.id}`,
              signals,
            },
          ];
    });
}

export function requireCompanyDuplicatesAcknowledged(
  database: Database,
  tenant: TenantContext,
  incoming: CompanyDuplicateInput,
  acknowledgeDuplicates: boolean | undefined,
): DuplicateCandidate[] {
  const candidates = findCompanyDuplicateCandidates(database, tenant, incoming);
  if (candidates.length > 0 && !acknowledgeDuplicates) {
    throw new DuplicateConflictError(DUPLICATE_COMPANY_WARNING, candidates);
  }
  return candidates;
}

export function requireOpportunityDuplicatesAcknowledged(
  database: Database,
  tenant: TenantContext,
  incoming: OpportunityDuplicateInput,
  acknowledgeDuplicates: boolean | undefined,
): DuplicateCandidate[] {
  const candidates = findOpportunityDuplicateCandidates(
    database,
    tenant,
    incoming,
  );
  if (candidates.length > 0 && !acknowledgeDuplicates) {
    throw new DuplicateConflictError(DUPLICATE_JOB_WARNING, candidates);
  }
  return candidates;
}
