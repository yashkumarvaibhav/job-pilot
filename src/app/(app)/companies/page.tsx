import Link from "next/link";

import { CompanyCreatePanel, TargetChip } from "@/components/company-form";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanySummaries } from "@/server/repos/companies";

function contactCountLabel(contactCount: number) {
  return `${contactCount} ${contactCount === 1 ? "contact" : "contacts"}`;
}

function CompanyContactCount({
  companyId,
  contactCount,
  className,
}: {
  companyId: string;
  contactCount: number;
  className?: string;
}) {
  const label = contactCountLabel(contactCount);
  return contactCount === 0 ? (
    <span>{label}</span>
  ) : (
    <Link
      aria-label={`${label}; show company contacts`}
      className={className}
      href={`/companies/${companyId}#company-contacts`}
    >
      {label}
    </Link>
  );
}

function CompanyOpenRoleCount({
  companyId,
  openRoleCount,
  className,
}: {
  companyId: string;
  openRoleCount: number;
  className?: string;
}) {
  const label = `${openRoleCount} ${openRoleCount === 1 ? "open role" : "open roles"}`;
  return openRoleCount === 0 ? (
    <span>{label}</span>
  ) : (
    <Link
      aria-label={`${label}; show company roles`}
      className={className}
      href={`/companies/${companyId}#company-opportunities`}
    >
      {label}
    </Link>
  );
}

export default async function CompaniesPage() {
  const tenant = await requireTenant();
  const companies = listCompanySummaries(getDatabase(), tenant);

  return (
    <section className="company-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Core CRM</p>
          <h1>Companies</h1>
          <p className="page-lede">
            Keep the organisations, careers pages, and targets behind every
            search thread in one place.
          </p>
        </div>
        <CompanyCreatePanel />
      </header>

      {companies.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>No companies yet. Add one to hang contacts and roles on.</p>
        </div>
      ) : (
        <>
          <div className="table-scroll company-table-wrap">
            <table className="tbl company-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Industry</th>
                  <th scope="col">Target</th>
                  <th scope="col">Contacts</th>
                  <th scope="col">Open roles</th>
                  <th scope="col">Next action</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <Link className="table-link" href={`/companies/${company.id}`}>
                        {company.name}
                      </Link>
                    </td>
                    <td>{company.industry ?? "—"}</td>
                    <td>{company.target ? <TargetChip /> : "—"}</td>
                    <td className="tnum">
                      <CompanyContactCount
                        className="table-link"
                        companyId={company.id}
                        contactCount={company.contactCount}
                      />
                    </td>
                    <td className="tnum">
                      <CompanyOpenRoleCount
                        className="table-link"
                        companyId={company.id}
                        openRoleCount={company.openRoleCount}
                      />
                    </td>
                    <td>{company.nextAction ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label="Companies" className="company-card-list">
            {companies.map((company) => (
              <li className="company-list-card" key={company.id}>
                <span className="company-list-card__heading">
                  <Link
                    className="company-list-card__name"
                    href={`/companies/${company.id}`}
                  >
                    <strong>{company.name}</strong>
                  </Link>
                  {company.target ? <TargetChip /> : null}
                </span>
                <span>{company.industry ?? "Industry not set"}</span>
                <CompanyContactCount
                  className="company-list-card__relationship-link tnum"
                  companyId={company.id}
                  contactCount={company.contactCount}
                />
                <CompanyOpenRoleCount
                  className="company-list-card__relationship-link tnum"
                  companyId={company.id}
                  openRoleCount={company.openRoleCount}
                />
                <span>{company.nextAction ?? "No next action"}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
