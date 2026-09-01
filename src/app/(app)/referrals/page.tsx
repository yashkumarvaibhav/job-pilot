import Link from "next/link";

import { ReferralCreateForm } from "@/components/referral-forms";
import { ReferralCollection } from "@/components/referral-list";
import {
  REFERRAL_LIST_PRESETS,
  REFERRAL_STAGES,
  calendarDateInZone,
  isReferralListPreset,
  isReferralStage,
} from "@/domain/referral";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listContacts } from "@/server/repos/contacts";
import { listOpportunities } from "@/server/repos/opportunities";
import { listReferrals } from "@/server/repos/referrals";

type Props = {
  searchParams: Promise<{ preset?: string; stage?: string }>;
};

export default async function ReferralsPage({ searchParams }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const params = await searchParams;
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const preset = isReferralListPreset(params.preset)
    ? params.preset
    : undefined;
  const stage = isReferralStage(params.stage) ? params.stage : undefined;
  const referrals = listReferrals(database, tenant, {
    asOfOn,
    preset,
    stage,
  });
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
    { href: "/referrals", label: "All", current: !preset && !stage },
    ...REFERRAL_LIST_PRESETS.map((item) => ({
      href: `/referrals?preset=${item.value}`,
      label: item.label,
      current: preset === item.value,
    })),
  ];

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
      <form className="referral-stage-filter" method="get">
        <div className="field">
          <label htmlFor="referral-stage-filter">Stage</label>
          <select
            defaultValue={stage ?? ""}
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
        <button className="btn btn--ghost" type="submit">
          Filter
        </button>
      </form>
      {referrals.length === 0 ? (
        <div className="data-state data-state--empty">
          <p>No referral requests. Open an opportunity and ask someone.</p>
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
