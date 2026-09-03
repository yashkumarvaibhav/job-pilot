import type { ReactNode } from "react";
import Link from "next/link";

import { ApplicationStageChip } from "@/components/application-status";
import { ContactStatusChip } from "@/components/contact-status";
import { OpportunityStageChip } from "@/components/opportunity-form";
import { ReferralStageChip } from "@/components/referral-status";
import {
  COMPANY_CONVERSION_TILES,
  type CompanyConversionStats,
} from "@/domain/analytics";
import { opportunityBucketLabel } from "@/domain/opportunity";
import type { ApplicationListItem } from "@/server/repos/applications";
import type { ContactListItem } from "@/server/repos/contacts";
import type { InterviewListItem } from "@/server/repos/interviews";
import type { OpportunityListItem } from "@/server/repos/opportunities";
import type { ReferralListItem } from "@/server/repos/referrals";

export function CompanyConversionTiles({
  stats,
}: {
  stats: CompanyConversionStats;
}) {
  return (
    <div className="tiles company-tiles">
      {COMPANY_CONVERSION_TILES.map((tile) => (
        <div className="tile" key={tile.key}>
          <span className="eyebrow">{tile.label}</span>
          <strong className="tnum">{stats[tile.key]}</strong>
        </div>
      ))}
    </div>
  );
}

export function CompanyRelatedLists({
  applications,
  contacts,
  interviews,
  opportunities,
  referrals,
}: {
  applications: ApplicationListItem[];
  contacts: ContactListItem[];
  interviews: InterviewListItem[];
  opportunities: OpportunityListItem[];
  referrals: ReferralListItem[];
}) {
  return (
    <>
      <RelatedSection
        empty="No contacts at this company yet."
        headingId="company-contacts"
        title="Contacts"
      >
        {contacts.length === 0 ? null : (
          <>
            <div className="table-scroll contact-table-wrap">
              <table className="tbl contact-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link className="table-link" href={`/contacts/${row.id}`}>
                          {row.name}
                        </Link>
                      </td>
                      <td>
                        <ContactStatusChip status={row.networkingStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-labelledby="company-contacts" className="contact-card-list">
              {contacts.map((row) => (
                <li key={row.id}>
                  <Link className="contact-list-card" href={`/contacts/${row.id}`}>
                    <span className="contact-list-card__heading">
                      <strong>{row.name}</strong>
                      <ContactStatusChip status={row.networkingStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </RelatedSection>

      <RelatedSection
        empty="No opportunities at this company yet."
        headingId="company-opportunities"
        title="Opportunities"
      >
        {opportunities.length === 0 ? null : (
          <>
            <div className="table-scroll opportunity-table-wrap">
              <table className="tbl opportunity-table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Bucket</th>
                    <th scope="col">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/opportunities/${row.id}`}
                        >
                          {row.role}
                        </Link>
                      </td>
                      <td>{opportunityBucketLabel(row.bucket)}</td>
                      <td>
                        <OpportunityStageChip stage={row.stage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul
              aria-labelledby="company-opportunities"
              className="opportunity-card-list"
            >
              {opportunities.map((row) => (
                <li key={row.id}>
                  <Link
                    className="opportunity-list-card"
                    href={`/opportunities/${row.id}`}
                  >
                    <span className="opportunity-list-card__heading">
                      <strong>{row.role}</strong>
                      <OpportunityStageChip stage={row.stage} />
                    </span>
                    <span>{opportunityBucketLabel(row.bucket)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </RelatedSection>

      <RelatedSection
        empty="No applications at this company yet."
        headingId="company-applications"
        title="Applications"
      >
        {applications.length === 0 ? null : (
          <>
            <div className="table-scroll application-table-wrap">
              <table className="tbl application-table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/opportunities/${row.opportunityId}`}
                        >
                          {row.role}
                        </Link>
                      </td>
                      <td>
                        <ApplicationStageChip stage={row.stage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul
              aria-labelledby="company-applications"
              className="application-card-list"
            >
              {applications.map((row) => (
                <li key={row.id}>
                  <Link
                    className="application-list-card"
                    href={`/opportunities/${row.opportunityId}`}
                  >
                    <span className="application-list-card__heading">
                      <strong>{row.role}</strong>
                      <ApplicationStageChip stage={row.stage} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </RelatedSection>

      <RelatedSection
        empty="No referral requests at this company yet."
        headingId="company-referrals"
        title="Referral history"
      >
        {referrals.length === 0 ? null : (
          <>
            <div className="table-scroll referral-table-wrap">
              <table className="tbl referral-table">
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link className="table-link" href={`/referrals/${row.id}`}>
                          {row.contactName}
                        </Link>
                      </td>
                      <td>
                        <ReferralStageChip stage={row.stage} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul
              aria-labelledby="company-referrals"
              className="referral-card-list"
            >
              {referrals.map((row) => (
                <li key={row.id}>
                  <Link
                    className="referral-list-card"
                    href={`/referrals/${row.id}`}
                  >
                    <span className="referral-list-card__heading">
                      <strong>{row.contactName}</strong>
                      <ReferralStageChip stage={row.stage} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </RelatedSection>

      <RelatedSection
        empty="No interviews at this company yet."
        headingId="company-interviews"
        title="Interviews"
      >
        {interviews.length === 0 ? null : (
          <>
            <div className="table-scroll interview-table-wrap">
              <table className="tbl interview-table">
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Round</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/opportunities/${row.opportunityId}`}
                        >
                          {row.role}
                        </Link>
                      </td>
                      <td>{row.kind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul
              aria-labelledby="company-interviews"
              className="interview-card-list"
            >
              {interviews.map((row) => (
                <li key={row.id}>
                  <Link
                    className="interview-list-card"
                    href={`/opportunities/${row.opportunityId}`}
                  >
                    <strong>{row.role}</strong>
                    <span>{row.kind}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </RelatedSection>
    </>
  );
}

function RelatedSection({
  children,
  empty,
  headingId,
  title,
}: {
  children: ReactNode;
  empty: string;
  headingId: string;
  title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="detail-section">
      <h2 id={headingId}>{title}</h2>
      {children ?? <p className="section-empty">{empty}</p>}
    </section>
  );
}
