import { Building2, ExternalLink } from "lucide-react";
import Link from "next/link";

import { RolledUpStageChip } from "@/components/application-status";
import { OpportunityCreatePanel } from "@/components/opportunity-form";
import { ListToolbar, type AppliedFilter } from "@/components/list-toolbar";
import { RecordCard, RecordCards } from "@/components/record-card";
import {
  SavedSearchForm,
  SavedSearchLinks,
} from "@/components/saved-search-panel";
import { StaleFlag } from "@/components/stale-chip";
import {
  listHref,
  pageSearchParams,
  recordCountLabel,
  withoutParams,
  type PageSearchParams,
} from "@/domain/list-filter";
import { calendarDateInZone } from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import {
  listOpportunities,
  parseOpportunityListFilter,
} from "@/server/repos/opportunities";
import { listScoredOpportunities } from "@/server/repos/scoring";
import { savedSearchResponse } from "@/server/repos/saved-search-http";
import { listSavedSearches } from "@/server/repos/saved-searches";
import { listStaleIndex } from "@/server/repos/rules";

type Props = { searchParams: Promise<PageSearchParams> };

function bucketHref(
  bucket: "saved" | "active" | "all",
  current: URLSearchParams,
) {
  const next = new URLSearchParams(current);
  if (bucket === "all") next.delete("bucket");
  else next.set("bucket", bucket);
  const query = next.toString();
  return query ? `/opportunities?${query}` : "/opportunities";
}

export default async function OpportunitiesPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const query = pageSearchParams(await searchParams);
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const filter = parseOpportunityListFilter(query, asOfOn);
  const opportunities = listScoredOpportunities(
    database,
    tenant,
    filter,
    asOfOn,
  );
  const allOpportunities = listOpportunities(database, tenant, "all");
  const companies = listCompanies(database, tenant).map(({ id, name }) => ({
    id,
    name,
  }));
  const defaultCompanyId = companies.some(
    (company) => company.id === filter.companyId,
  )
    ? filter.companyId
    : undefined;
  const companyFirstAdd =
    query.get("add") === "1" && defaultCompanyId !== undefined;
  const searches = listSavedSearches(database, tenant, "opportunities").map(
    savedSearchResponse,
  );
  const stale = listStaleIndex(database, tenant, asOfOn);
  const priorities = [
    ...new Set(
      allOpportunities
        .map((row) => row.priority)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const bucket = filter.bucket ?? "all";
  const hasFilters =
    bucket !== "all" ||
    filter.companyId !== undefined ||
    filter.priority !== undefined ||
    filter.deadlineWithinDays !== undefined ||
    filter.appliedWithinDays !== undefined ||
    filter.stale === true;
  const companyName = companies.find(
    (company) => company.id === filter.companyId,
  )?.name;
  // The bucket is a tab with its own visible current state, so it is never a
  // chip; everything else the URL applies is stated here (D-063).
  const applied: AppliedFilter[] = [
    ...(filter.companyId !== undefined
      ? [
          {
            key: "company",
            label: "Company",
            value: companyName ?? filter.companyId,
          },
        ]
      : []),
    ...(filter.priority !== undefined
      ? [{ key: "priority", label: "Priority", value: filter.priority }]
      : []),
    ...(filter.deadlineWithinDays !== undefined
      ? [
          {
            key: "deadlineWithinDays",
            label: "Deadline",
            value: `Within ${filter.deadlineWithinDays} days`,
          },
        ]
      : []),
    ...(filter.appliedWithinDays !== undefined
      ? [
          {
            key: "appliedWithinDays",
            label: "Applied",
            value: `In the last ${filter.appliedWithinDays} days`,
          },
        ]
      : []),
    ...(filter.stale === true
      ? [{ key: "stale", label: "Stale", value: "Stale only" }]
      : []),
    ...(filter.sort !== undefined
      ? [{ key: "sort", label: "Sort", value: "Priority score" }]
      : []),
  ].map((item) => ({
    ...item,
    clearHref: listHref("/opportunities", withoutParams(query, item.key)),
  }));
  const savedSearchQuery = query.toString();

  return (
    <section className="opportunity-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Job pipeline</p>
          <h1>Opportunities</h1>
          <p className="page-lede">
            Separate roles saved for later from the openings you are actively
            pursuing.
          </p>
        </div>
        <OpportunityCreatePanel
          companies={companies}
          defaultBucket={companyFirstAdd ? "active" : undefined}
          defaultCompanyId={defaultCompanyId}
          initiallyOpen={query.get("add") === "1"}
        />
      </header>
      <ListToolbar
        applied={applied}
        clearAllHref="/opportunities"
        countLabel={recordCountLabel(opportunities.length, "role", "roles")}
        filterFormLabel="opportunity"
        savedSearches={<SavedSearchLinks searches={searches} />}
        tabs={
          <nav aria-label="Opportunity bucket" className="filter-tabs">
            {(["saved", "active", "all"] as const).map((item) => (
              <Link
                aria-current={bucket === item ? "page" : undefined}
                href={bucketHref(item, query)}
                key={item}
              >
                {item === "saved" ? "Saved" : item === "active" ? "Active" : "All"}
              </Link>
            ))}
          </nav>
        }
      >
        <form
          aria-label="Filter opportunities"
          className="list-filter"
          method="get"
        >
          {bucket !== "all" ? (
            <input name="bucket" type="hidden" value={bucket} />
          ) : null}
          <div className="list-filter__fields">
            <div className="field">
              <label htmlFor="opportunity-company-filter">Company</label>
              <select defaultValue={filter.companyId ?? ""} id="opportunity-company-filter" name="company">
                <option value="">All companies</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opportunity-priority-filter">Priority</label>
              <select defaultValue={filter.priority ?? ""} id="opportunity-priority-filter" name="priority">
                <option value="">All priorities</option>
                {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opportunity-deadline-filter">Deadline</label>
              <select defaultValue={filter.deadlineWithinDays?.toString() ?? ""} id="opportunity-deadline-filter" name="deadlineWithinDays">
                <option value="">Any deadline</option>
                <option value="3">Within 3 days</option>
                <option value="7">Within 7 days</option>
                <option value="14">Within 14 days</option>
                <option value="30">Within 30 days</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="opportunity-applied-filter">Applied</label>
              <select defaultValue={filter.appliedWithinDays?.toString() ?? ""} id="opportunity-applied-filter" name="appliedWithinDays">
                <option value="">Any application date</option>
                <option value="30">In the last 30 days</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="opportunity-stale-filter">Stale</label>
              <select defaultValue={filter.stale ? "1" : ""} id="opportunity-stale-filter" name="stale">
                <option value="">Any opportunity</option>
                <option value="1">Stale only</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="opportunity-sort">Sort</label>
              <select defaultValue={filter.sort ?? ""} id="opportunity-sort" name="sort">
                <option value="">Company and role</option>
                <option value="score">Priority score</option>
              </select>
            </div>
          </div>
          <div className="list-filter__actions">
            <button className="btn" type="submit">Apply filters</button>
            {applied.length > 0 ? <Link className="btn btn--ghost" href="/opportunities">Clear filters</Link> : null}
          </div>
        </form>
        {savedSearchQuery ? (
          <SavedSearchForm entityType="opportunities" query={savedSearchQuery} />
        ) : null}
      </ListToolbar>
      {opportunities.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>{hasFilters ? "No opportunities match these filters." : "No opportunities. Paste a job URL or add one from a conversation."}</p>
        </div>
      ) : (
        <RecordCards label="Opportunities">
          {opportunities.map((row) => (
            <RecordCard
              chips={<StaleFlag reasons={stale.opportunity.get(row.id) ?? []} />}
              destinations={[
                {
                  key: "post",
                  label: "Job post",
                  missingLabel: "No job URL saved",
                  href: row.url,
                  icon: <ExternalLink aria-hidden="true" />,
                },
                {
                  key: "company",
                  label: "Company",
                  missingLabel: "No company",
                  href: `/companies/${row.companyId}`,
                  icon: <Building2 aria-hidden="true" />,
                  external: false,
                },
              ]}
              facts={[
                { label: "Job ID", value: row.jobId ?? "Not recorded" },
                {
                  label: "Bucket",
                  value: row.bucket === "saved" ? "Saved" : "Active",
                },
                { label: "Priority", value: row.priority ?? "Not set" },
                { label: "Score", value: row.score },
                { label: "Deadline", value: row.deadlineOn ?? "None set" },
                { label: "Next action", value: row.nextAction ?? "None set" },
              ]}
              heading={
                <Link href={`/opportunities/${row.id}`}>{row.role}</Link>
              }
              key={row.id}
              status={
                <RolledUpStageChip
                  applicationStage={row.application?.stage}
                  opportunityStage={row.stage}
                />
              }
              subtitle={row.companyName}
            />
          ))}
        </RecordCards>
      )}
    </section>
  );
}
