import Link from "next/link";

import { ReferralCreateForm } from "@/components/referral-forms";
import { ReferralCollection } from "@/components/referral-list";
import {
  REFERRAL_LIST_PRESETS,
  REFERRAL_STAGES,
  calendarDateInZone,
} from "@/domain/referral";
import {
  pageSearchParams,
  type PageSearchParams,
} from "@/domain/list-filter";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import { listContacts } from "@/server/repos/contacts";
import { listOpportunities } from "@/server/repos/opportunities";
import {
  listReferrals,
  parseReferralListFilter,
} from "@/server/repos/referrals";

type Props = {
  searchParams: Promise<PageSearchParams>;
};

export default async function ReferralsPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const query = pageSearchParams(await searchParams);
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const filter = parseReferralListFilter(query, asOfOn);
  const referrals = listReferrals(database, tenant, filter);
  const companies = listCompanies(database, tenant);
  const contacts = listContacts(database, tenant).map(({ id, name }) => ({
    id,
    name,
  }));
  const opportunities = listOpportunities(database, tenant, "all").map(
    (row) => ({
      id: row.id,
      role: row.role,
      companyName: row.companyName,
    }),
  );
  const tabs = [
    {
      href: "/referrals",
      label: "All",
      current: !filter.preset && !filter.stage,
    },
    ...REFERRAL_LIST_PRESETS.map((item) => ({
      href: `/referrals?preset=${item.value}`,
      label: item.label,
      current: filter.preset === item.value,
    })),
  ];
  const hasFilters =
    filter.preset !== undefined ||
    filter.stage !== undefined ||
    filter.companyId !== undefined ||
    filter.noResponseDays !== undefined;

  return (
    <section className="referral-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Ask and follow through</p>
          <h1>Referrals</h1>
          <p className="page-lede">
            Referral is its own workflow. A person can be asked before a job id
            exists.
          </p>
        </div>
      </header>
      <nav aria-label="Referral presets" className="filter-tabs">
        {tabs.map((tab) => (
          <Link
            aria-current={tab.current ? "page" : undefined}
            href={tab.href}
            key={tab.href}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <form aria-label="Filter referrals" className="list-filter" method="get">
        <div className="list-filter__fields">
          <div className="field">
            <label htmlFor="referral-company-filter">Company</label>
            <select
              defaultValue={filter.companyId ?? ""}
              id="referral-company-filter"
              name="company"
            >
              <option value="">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="referral-stage-filter">Stage</label>
            <select
              defaultValue={filter.stage ?? ""}
              id="referral-stage-filter"
              name="stage"
            >
              <option value="">All stages</option>
              {REFERRAL_STAGES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="referral-response-filter">No response for</label>
            <select
              defaultValue={filter.noResponseDays?.toString() ?? ""}
              id="referral-response-filter"
              name="noResponseDays"
            >
              <option value="">Any response age</option>
              <option value="3">More than 3 days</option>
              <option value="7">More than 7 days</option>
              <option value="14">More than 14 days</option>
              <option value="30">More than 30 days</option>
            </select>
          </div>
        </div>
        <div className="list-filter__actions">
          <button className="btn" type="submit">
            Apply filters
          </button>
          {hasFilters ? (
            <Link className="btn btn--ghost" href="/referrals">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>
      {referrals.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>
            {hasFilters
              ? "No referral requests match these filters."
              : "No referral requests. Open an opportunity and ask someone."}
          </p>
        </div>
      ) : (
        <ReferralCollection
          empty="No referral requests. Open an opportunity and ask someone."
          rows={referrals}
        />
      )}
      {contacts.length === 0 ? (
        <p className="section-empty">
          Add a contact before logging a referral request.
        </p>
      ) : (
        <section aria-labelledby="add-referral" className="detail-section">
          <h2 id="add-referral">Add referral</h2>
          <ReferralCreateForm
            contacts={contacts}
            defaultRequestedOn={asOfOn}
            defaultStage="requested"
            opportunities={opportunities}
          />
        </section>
      )}
    </section>
  );
}
