import { Briefcase, Globe } from "lucide-react";
import { PreviewLink as Link } from "@/components/record-preview";

import { CompanyCreatePanel, TargetChip } from "@/components/company-form";
import { RecordCard, RecordCards } from "@/components/record-card";
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
        <RecordCards label="Companies">
          {companies.map((company) => (
            <RecordCard
              chips={company.target ? <TargetChip /> : null}
              destinations={[
                {
                  key: "website",
                  label: "Website",
                  missingLabel: "No website saved",
                  href: company.website,
                  icon: <Globe aria-hidden="true" />,
                },
                {
                  key: "careers",
                  label: "Careers",
                  missingLabel: "No careers page saved",
                  href: company.careersUrl,
                  icon: <Briefcase aria-hidden="true" />,
                },
              ]}
              facts={[
                { label: "Industry", value: company.industry ?? "Not set" },
                {
                  label: "Contacts",
                  value: (
                    <CompanyContactCount
                      companyId={company.id}
                      contactCount={company.contactCount}
                    />
                  ),
                },
                {
                  label: "Open roles",
                  value: (
                    <CompanyOpenRoleCount
                      companyId={company.id}
                      openRoleCount={company.openRoleCount}
                    />
                  ),
                },
                {
                  label: "Next action",
                  value: company.nextAction ?? "None set",
                },
              ]}
              heading={<Link href={`/companies/${company.id}`}>{company.name}</Link>}
              key={company.id}
            />
          ))}
        </RecordCards>
      )}
    </section>
  );
}
