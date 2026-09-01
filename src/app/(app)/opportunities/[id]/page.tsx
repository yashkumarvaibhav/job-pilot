import Link from "next/link";

import {
  ApplicationEditForm,
  MarkAppliedForm,
} from "@/components/application-forms";
import {
  RolledUpStageChip,
  stageMachineLabel,
} from "@/components/application-status";
import { LinkContactForm } from "@/components/opportunity-contact-forms";
import { OpportunityEditForm } from "@/components/opportunity-form";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import { listContacts } from "@/server/repos/contacts";
import {
  getOpportunity,
  listOpportunityContacts,
} from "@/server/repos/opportunities";

type Props = { params: Promise<{ id: string }> };

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value === null || value === ""
          ? "Not set"
          : typeof value === "boolean"
            ? value
              ? "Yes"
              : "No"
            : value}
      </dd>
    </div>
  );
}

export default async function OpportunityDetailPage({ params }: Props) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const { id } = await params;
  const row = getOpportunity(database, tenant, id);
  if (!row) {
    return (
      <section className="data-state data-state--error opportunity-not-found">
        <p className="eyebrow">Not found</p>
        <h1>Opportunity not found</h1>
        <p>This opportunity does not exist in your workspace.</p>
        <Link className="btn btn--ghost" href="/opportunities">
          Back to opportunities
        </Link>
      </section>
    );
  }

  const companies = listCompanies(database, tenant).map(
    ({ id: companyId, name }) => ({ id: companyId, name }),
  );
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const defaultAppliedOn = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const linkedContacts = listOpportunityContacts(database, tenant, row.id);
  const linkedIds = new Set(linkedContacts.map((item) => item.contactId));
  const linkableContacts = listContacts(database, tenant)
    .filter((item) => !linkedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      companyName: item.companyName,
    }));
  const fields = [
    ["Job ID", row.jobId],
    ["Job URL", row.url],
    ["Location", row.location],
    ["Work mode", row.workMode],
    ["Employment type", row.employmentType],
    ["Experience requirement", row.experienceRequirement],
    ["Source", row.source],
    ["Date discovered", row.discoveredOn],
    ["Posting date", row.postedOn],
    ["Deadline", row.deadlineOn],
    ["Salary / compensation", row.compensation],
    ["Priority", row.priority],
    ["Interest score", row.interestScore],
    ["Eligibility", row.eligibility],
    ["Referral preferred", row.referralPreferred],
    ["Resume version ID", row.resumeVersionId],
    ["Next action", row.nextAction],
    ["Tags", row.tagsJson.length ? row.tagsJson.join(", ") : null],
    ["Notes", row.notes],
  ] as const;

  return (
    <article className="opportunity-detail">
      <Link className="back-link" href="/opportunities">
        <span aria-hidden="true">←</span> Opportunities
      </Link>
      <header className="detail-header">
        <div>
          <p className="eyebrow">Opportunity</p>
          <h1>{row.role}</h1>
          <p className="page-lede">
            <Link className="inline-link" href={`/companies/${row.companyId}`}>
              {row.companyName}
            </Link>
            {" · "}
            {row.bucket === "saved" ? "Saved" : "Active"}
          </p>
        </div>
        <div className="rolled-up-stage">
          <RolledUpStageChip
            applicationStage={row.application?.stage}
            opportunityStage={row.stage}
          />
          <p className="stage-machine">
            {stageMachineLabel(row.application?.stage)}
          </p>
        </div>
      </header>
      <section aria-labelledby="opportunity-fields" className="detail-section">
        <h2 id="opportunity-fields">Opportunity details</h2>
        <dl className="opportunity-field-grid">
          {fields.map(([label, value]) => (
            <Field key={label} label={label} value={value} />
          ))}
        </dl>
      </section>
      <section aria-labelledby="jd-snapshot" className="detail-section">
        <h2 id="jd-snapshot">Job description snapshot</h2>
        <div className="jd-snapshot">
          {row.jdSnapshot ?? "No job description snapshot saved."}
        </div>
      </section>
      <section aria-labelledby="linked-contacts" className="detail-section">
        <h2 id="linked-contacts">Linked contacts</h2>
        {linkedContacts.length === 0 ? (
          <p className="section-empty">No contacts linked to this opening yet.</p>
        ) : (
          <>
            <div className="table-scroll contact-table-wrap">
              <table className="tbl contact-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Company</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedContacts.map((item) => (
                    <tr key={item.contactId}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/contacts/${item.contactId}`}
                        >
                          {item.contactName}
                        </Link>
                      </td>
                      <td>{item.companyName ?? "No company"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="Linked contacts" className="contact-card-list">
              {linkedContacts.map((item) => (
                <li key={item.contactId}>
                  <Link
                    className="contact-list-card"
                    href={`/contacts/${item.contactId}`}
                  >
                    <span className="contact-list-card__heading">
                      <strong>{item.contactName}</strong>
                    </span>
                    <span>{item.companyName ?? "No company"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <LinkContactForm contacts={linkableContacts} opportunityId={row.id} />
      </section>
      <section
        aria-labelledby="application-heading"
        className="detail-section application-block"
        id="application"
      >
        <h2 id="application-heading">Application</h2>
        {row.application ? (
          <ApplicationEditForm application={row.application} />
        ) : (
          <MarkAppliedForm
            defaultAppliedOn={defaultAppliedOn}
            opportunityId={row.id}
          />
        )}
      </section>
      <section aria-labelledby="edit-opportunity" className="detail-section">
        <h2 id="edit-opportunity">Edit opportunity</h2>
        <OpportunityEditForm companies={companies} opportunity={row} />
      </section>
    </article>
  );
}
