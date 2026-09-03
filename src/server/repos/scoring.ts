import { and, eq, inArray } from "drizzle-orm";

import {
  scoreOpportunity,
  type OpportunityScore,
  type OpportunityScoringInputs,
} from "../../domain/scoring";
import { shiftCalendarDate } from "../../domain/referral";
import type { AppDatabase } from "../db/client";
import { company, referralRequest } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import {
  getOpportunity,
  listOpportunities,
  type OpportunityListFilter,
  type OpportunityListItem,
} from "./opportunities";
import { readWorkspaceSettings } from "./settings";

export type ScoredOpportunityListItem = OpportunityListItem &
  OpportunityScore & {
    scoringInputs: OpportunityScoringInputs;
  };

function normalizedSignal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isNewGradRole(row: OpportunityListItem): boolean {
  const signals = [row.role, ...(row.tagsJson ?? [])].map(normalizedSignal);
  return signals.some(
    (signal) =>
      /\bnew grad(?:uate)?\b/.test(signal) ||
      /\bentry level\b/.test(signal) ||
      /\bfresher\b/.test(signal) ||
      /\bgraduate (?:software|engineer|role)\b/.test(signal),
  );
}

function isPreferredLocation(row: OpportunityListItem): boolean {
  return (row.tagsJson ?? [])
    .map(normalizedSignal)
    .includes("preferred location");
}

function experienceExceedsEligibility(row: OpportunityListItem): boolean {
  const tags = (row.tagsJson ?? []).map(normalizedSignal);
  if (
    tags.includes("experience gap") ||
    tags.includes("experience exceeds eligibility")
  ) {
    return true;
  }
  if (!row.experienceRequirement || !row.eligibility) {
    return false;
  }
  const eligibility = normalizedSignal(row.eligibility);
  return (
    /\bnot eligible\b/.test(eligibility) ||
    /\bineligible\b/.test(eligibility) ||
    /\bexperience shortfall\b/.test(eligibility) ||
    /\bdoes not meet\b/.test(eligibility)
  );
}

function wasPostedWithin48Hours(
  postedOn: string | null,
  asOfOn: string,
): boolean {
  return (
    postedOn !== null &&
    postedOn >= shiftCalendarDate(asOfOn, -1) &&
    postedOn <= asOfOn
  );
}

function scoringInputs(
  row: OpportunityListItem,
  targetCompanyIds: ReadonlySet<string>,
  referralOpportunityIds: ReadonlySet<string>,
  asOfOn: string,
): OpportunityScoringInputs {
  return {
    targetCompany: targetCompanyIds.has(row.companyId),
    newGradRole: isNewGradRole(row),
    preferredLocation: isPreferredLocation(row),
    referralAvailable: referralOpportunityIds.has(row.id),
    postedWithin48Hours: wasPostedWithin48Hours(row.postedOn, asOfOn),
    experienceExceedsEligibility: experienceExceedsEligibility(row),
  };
}

function scoreRows(
  database: AppDatabase,
  tenant: TenantContext,
  rows: OpportunityListItem[],
  asOfOn: string,
): ScoredOpportunityListItem[] {
  if (rows.length === 0) {
    return [];
  }
  const companyIds = [...new Set(rows.map((row) => row.companyId))];
  const opportunityIds = rows.map((row) => row.id);
  const targetCompanyIds = new Set(
    database
      .select({ id: company.id })
      .from(company)
      .where(
        and(
          eq(company.workspaceId, tenant.workspaceId),
          eq(company.target, true),
          inArray(company.id, companyIds),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  const referralOpportunityIds = new Set(
    database
      .select({ opportunityId: referralRequest.opportunityId })
      .from(referralRequest)
      .where(
        and(
          eq(referralRequest.workspaceId, tenant.workspaceId),
          eq(referralRequest.stage, "referral_received"),
          inArray(referralRequest.opportunityId, opportunityIds),
        ),
      )
      .all()
      .flatMap((row) => (row.opportunityId ? [row.opportunityId] : [])),
  );
  const weights = readWorkspaceSettings(database, tenant).scoringWeights;

  return rows.map((row) => {
    const inputs = scoringInputs(
      row,
      targetCompanyIds,
      referralOpportunityIds,
      asOfOn,
    );
    return {
      ...row,
      ...scoreOpportunity(inputs, weights),
      scoringInputs: inputs,
    };
  });
}

export function listScoredOpportunities(
  database: AppDatabase,
  tenant: TenantContext,
  filter: OpportunityListFilter,
  asOfOn: string,
): ScoredOpportunityListItem[] {
  const rows = scoreRows(
    database,
    tenant,
    listOpportunities(database, tenant, filter),
    asOfOn,
  );
  if (typeof filter === "string" || filter.sort !== "score") {
    return rows;
  }
  return rows.sort(
    (left, right) =>
      right.score - left.score ||
      left.companyName.localeCompare(right.companyName) ||
      left.role.localeCompare(right.role) ||
      left.id.localeCompare(right.id),
  );
}

export function getScoredOpportunity(
  database: AppDatabase,
  tenant: TenantContext,
  id: string,
  asOfOn: string,
): ScoredOpportunityListItem | undefined {
  const row = getOpportunity(database, tenant, id);
  return row ? scoreRows(database, tenant, [row], asOfOn)[0] : undefined;
}
