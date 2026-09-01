import Link from "next/link";

import { CompanyCreatePanel, TargetChip } from "@/components/company-form";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";

export default async function CompaniesPage() {
  const tenant = await requireTenant();
  const companies = listCompanies(getDatabase(), tenant);

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
                    <td className="tnum">0</td>
                    <td className="tnum">0</td>
                    <td>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label="Companies" className="company-card-list">
            {companies.map((company) => (
              <li key={company.id}>
                <Link className="company-list-card" href={`/companies/${company.id}`}>
                  <span className="company-list-card__heading">
                    <strong>{company.name}</strong>
                    {company.target ? <TargetChip /> : null}
                  </span>
                  <span>{company.industry ?? "Industry not set"}</span>
                  <span className="tnum">0 contacts · 0 open roles</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
