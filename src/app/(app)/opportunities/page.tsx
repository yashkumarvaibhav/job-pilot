import Link from "next/link";

import { RolledUpStageChip } from "@/components/application-status";
import { OpportunityCreatePanel } from "@/components/opportunity-form";
import { SavedSearchPanel } from "@/components/saved-search-panel";
import { StaleFlag } from "@/components/stale-chip";
import {
  pageSearchParams,
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
    filter.appliedWithinDays !== undefined;
  const hasControls = hasFilters || filter.sort !== undefined;

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
        <OpportunityCreatePanel companies={companies} />
      </header>
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
            <label htmlFor="opportunity-sort">Sort</label>
            <select defaultValue={filter.sort ?? ""} id="opportunity-sort" name="sort">
              <option value="">Company and role</option>
              <option value="score">Priority score</option>
            </select>
          </div>
        </div>
        <div className="list-filter__actions">
          <button className="btn" type="submit">Apply filters</button>
          {hasControls ? <Link className="btn btn--ghost" href="/opportunities">Clear filters</Link> : null}
        </div>
      </form>
      <SavedSearchPanel
        entityType="opportunities"
        query={query.toString()}
        searches={searches}
      />
      {opportunities.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>{hasFilters ? "No opportunities match these filters." : "No opportunities. Paste a job URL or add one from a conversation."}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll opportunity-table-wrap">
            <table className="tbl opportunity-table">
              <thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Job ID</th><th scope="col">Bucket</th><th scope="col">Stage</th><th scope="col">Health</th><th scope="col">Priority</th><th scope="col">Score</th><th scope="col">Deadline</th><th scope="col">Next action</th></tr></thead>
              <tbody>{opportunities.map((row) => <tr key={row.id}><td>{row.companyName}</td><td><Link className="table-link" href={`/opportunities/${row.id}`}>{row.role}</Link></td><td className="tnum mono-value">{row.jobId ?? "—"}</td><td>{row.bucket === "saved" ? "Saved" : "Active"}</td><td><RolledUpStageChip applicationStage={row.application?.stage} opportunityStage={row.stage} /></td><td><StaleFlag reasons={stale.opportunity.get(row.id) ?? []} /></td><td>{row.priority ?? "—"}</td><td className="tnum">{row.score}</td><td className="tnum">{row.deadlineOn ?? "—"}</td><td>{row.nextAction ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
          <ul aria-label="Opportunities" className="opportunity-card-list">
            {opportunities.map((row) => <li key={row.id}><Link className="opportunity-list-card" href={`/opportunities/${row.id}`}><span className="opportunity-list-card__heading"><strong>{row.role}</strong><span>{row.bucket === "saved" ? "Saved" : "Active"}</span></span><span>{row.companyName}{row.jobId ? ` · ${row.jobId}` : ""}</span><span className="tnum">Priority score {row.score}</span><RolledUpStageChip applicationStage={row.application?.stage} opportunityStage={row.stage} /><StaleFlag reasons={stale.opportunity.get(row.id) ?? []} /><span className="tnum">{row.deadlineOn ? `Deadline ${row.deadlineOn}` : "No deadline"}</span></Link></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
