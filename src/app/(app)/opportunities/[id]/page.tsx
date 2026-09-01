import Link from "next/link";

import { OpportunityEditForm, OpportunityStageChip } from "@/components/opportunity-form";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";
import { getOpportunity } from "@/server/repos/opportunities";

type Props = { params: Promise<{ id: string }> };

function Field({ label, value }: { label: string; value: string | number | boolean | null }) {
  return <div><dt>{label}</dt><dd>{value === null || value === "" ? "Not set" : typeof value === "boolean" ? value ? "Yes" : "No" : value}</dd></div>;
}

export default async function OpportunityDetailPage({ params }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const { id } = await params;
  const row = getOpportunity(database, tenant, id);
  if (!row) return <section className="data-state data-state--error opportunity-not-found"><p className="eyebrow">Not found</p><h1>Opportunity not found</h1><p>This opportunity does not exist in your workspace.</p><Link className="btn btn--ghost" href="/opportunities">Back to opportunities</Link></section>;
  const companies = listCompanies(database, tenant).map(({ id: companyId, name }) => ({ id: companyId, name }));
  const fields = [
    ["Job ID", row.jobId], ["Job URL", row.url], ["Location", row.location], ["Work mode", row.workMode], ["Employment type", row.employmentType],
    ["Experience requirement", row.experienceRequirement], ["Source", row.source], ["Date discovered", row.discoveredOn], ["Posting date", row.postedOn],
    ["Deadline", row.deadlineOn], ["Salary / compensation", row.compensation], ["Priority", row.priority], ["Interest score", row.interestScore],
    ["Eligibility", row.eligibility], ["Referral preferred", row.referralPreferred], ["Resume version ID", row.resumeVersionId], ["Next action", row.nextAction],
    ["Tags", row.tagsJson.length ? row.tagsJson.join(", ") : null], ["Notes", row.notes],
  ] as const;
  return <article className="opportunity-detail">
    <Link className="back-link" href="/opportunities"><span aria-hidden="true">←</span> Opportunities</Link>
    <header className="detail-header"><div><p className="eyebrow">Opportunity</p><h1>{row.role}</h1><p className="page-lede"><Link className="inline-link" href={`/companies/${row.companyId}`}>{row.companyName}</Link> · {row.bucket === "saved" ? "Saved" : "Active"}</p></div><OpportunityStageChip stage={row.stage} /></header>
    <section aria-labelledby="opportunity-fields" className="detail-section"><h2 id="opportunity-fields">Opportunity details</h2><dl className="opportunity-field-grid">{fields.map(([label, value]) => <Field key={label} label={label} value={value} />)}</dl></section>
    <section aria-labelledby="jd-snapshot" className="detail-section"><h2 id="jd-snapshot">Job description snapshot</h2><div className="jd-snapshot">{row.jdSnapshot ?? "No job description snapshot saved."}</div></section>
    <section aria-labelledby="edit-opportunity" className="detail-section"><h2 id="edit-opportunity">Edit opportunity</h2><OpportunityEditForm companies={companies} opportunity={row} /></section>
  </article>;
}
