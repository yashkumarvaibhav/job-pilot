import Link from "next/link";

import { OpportunityCreatePanel, OpportunityStageChip } from "@/components/opportunity-form";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";
import { listOpportunities, type OpportunityListFilter } from "@/server/repos/opportunities";

type Props = { searchParams: Promise<{ bucket?: string }> };

export default async function OpportunitiesPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const value = (await searchParams).bucket ?? "all";
  const filter: OpportunityListFilter = value === "saved" || value === "active" ? value : "all";
  const database = getDatabase();
  const opportunities = listOpportunities(database, tenant, filter);
  const companies = listCompanies(database, tenant).map(({ id, name }) => ({ id, name }));

  return <section className="opportunity-page">
    <header className="page-header"><div><p className="eyebrow">Job pipeline</p><h1>Opportunities</h1><p className="page-lede">Separate roles saved for later from the openings you are actively pursuing.</p></div><OpportunityCreatePanel companies={companies} /></header>
    <nav aria-label="Opportunity bucket" className="filter-tabs">{(["saved", "active", "all"] as const).map((item) => <Link aria-current={filter === item ? "page" : undefined} href={item === "all" ? "/opportunities" : `/opportunities?bucket=${item}`} key={item}>{item === "saved" ? "Saved" : item === "active" ? "Active" : "All"}</Link>)}</nav>
    {opportunities.length === 0 ? <div className="data-state data-state--empty"><p>No opportunities. Paste a job URL or add one from a conversation.</p></div> : <>
      <div className="table-scroll opportunity-table-wrap"><table className="tbl opportunity-table"><thead><tr><th scope="col">Company</th><th scope="col">Role</th><th scope="col">Job ID</th><th scope="col">Bucket</th><th scope="col">Stage</th><th scope="col">Priority</th><th scope="col">Deadline</th><th scope="col">Next action</th></tr></thead><tbody>{opportunities.map((row) => <tr key={row.id}><td>{row.companyName}</td><td><Link className="table-link" href={`/opportunities/${row.id}`}>{row.role}</Link></td><td className="tnum mono-value">{row.jobId ?? "—"}</td><td>{row.bucket === "saved" ? "Saved" : "Active"}</td><td><OpportunityStageChip stage={row.stage} /></td><td>{row.priority ?? "—"}</td><td className="tnum">{row.deadlineOn ?? "—"}</td><td>{row.nextAction ?? "—"}</td></tr>)}</tbody></table></div>
      <ul aria-label="Opportunities" className="opportunity-card-list">{opportunities.map((row) => <li key={row.id}><Link className="opportunity-list-card" href={`/opportunities/${row.id}`}><span className="opportunity-list-card__heading"><strong>{row.role}</strong><span>{row.bucket === "saved" ? "Saved" : "Active"}</span></span><span>{row.companyName}{row.jobId ? ` · ${row.jobId}` : ""}</span><OpportunityStageChip stage={row.stage} /><span className="tnum">{row.deadlineOn ? `Deadline ${row.deadlineOn}` : "No deadline"}</span></Link></li>)}</ul>
    </>}
  </section>;
}
