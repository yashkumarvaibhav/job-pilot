import Link from "next/link";

import { CompanyEditForm, TargetChip } from "@/components/company-form";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { getCompany } from "@/server/repos/companies";

type CompanyDetailPageProps = {
  params: Promise<{ id: string }>;
};

const counts = [
  ["Contacts", 0],
  ["Open roles", 0],
  ["Applications", 0],
  ["Referrals", 0],
  ["Interviews", 0],
] as const;

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "Not set"}</dd>
    </div>
  );
}

export default async function CompanyDetailPage({
  params,
}: CompanyDetailPageProps) {
  const tenant = await requireTenant();
  const { id } = await params;
  const company = getCompany(getDatabase(), tenant, id);

  if (!company) {
    return (
      <section className="data-state data-state--error company-not-found">
        <p className="eyebrow">Not found</p>
        <h1>Company not found</h1>
        <p>This company does not exist in your workspace.</p>
        <Link className="btn btn--ghost" href="/companies">
          Back to companies
        </Link>
      </section>
    );
  }

  return (
    <article className="company-detail">
      <Link className="back-link" href="/companies">
        <span aria-hidden="true">←</span> Companies
      </Link>

      <header className="detail-header">
        <div>
          <p className="eyebrow">Company</p>
          <h1>{company.name}</h1>
        </div>
        {company.target ? <TargetChip /> : null}
      </header>

      <section aria-labelledby="company-fields" className="detail-section">
        <h2 id="company-fields">Company details</h2>
        <dl className="company-field-grid">
          <Field label="Website" value={company.website} />
          <Field label="Careers URL" value={company.careersUrl} />
          <Field label="Industry" value={company.industry} />
          <Field label="Company type" value={company.type} />
          <Field label="Locations" value={company.locations} />
          <Field label="Notes" value={company.notes} />
        </dl>
      </section>

      <section aria-labelledby="company-counts" className="detail-section">
        <h2 id="company-counts">Search activity</h2>
        <div className="tiles company-tiles">
          {counts.map(([label, value]) => (
            <div className="tile" key={label}>
              <span className="eyebrow">{label}</span>
              <strong className="tnum">{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="edit-company" className="detail-section">
        <h2 id="edit-company">Edit company</h2>
        <CompanyEditForm company={company} />
      </section>
    </article>
  );
}
