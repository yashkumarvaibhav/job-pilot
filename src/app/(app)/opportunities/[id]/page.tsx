import Link from "next/link";

import {
  ApplicationEditForm,
  MarkAppliedForm,
} from "@/components/application-forms";
import {
  AssessmentAddForm,
  AssessmentEditForm,
  AssessmentStatusChip,
} from "@/components/assessment-forms";
import {
  InterviewAddForm,
  InterviewEditForm,
} from "@/components/interview-forms";
import {
  RolledUpStageChip,
  stageMachineLabel,
} from "@/components/application-status";
import { ActivityTimeline } from "@/components/activity-timeline";
import { LinkContactForm } from "@/components/opportunity-contact-forms";
import { OpportunityEditForm } from "@/components/opportunity-form";
import { ReferralCreateForm } from "@/components/referral-forms";
import { ReferralCollection } from "@/components/referral-list";
import { TagPicker } from "@/components/tag-picker";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import {
  listVersionChoices,
  versionDisplayNames,
} from "@/server/repos/documents";
import { listContacts } from "@/server/repos/contacts";
import {
  getOpportunity,
  listOpportunityContacts,
} from "@/server/repos/opportunities";
import { listInterviews } from "@/server/repos/interviews";
import { listAssessments } from "@/server/repos/assessments";
import { listReferrals } from "@/server/repos/referrals";
import { listActivity } from "@/server/repos/activity";
import { listEntityTags, listTags } from "@/server/repos/tags";
import { formatInterviewWhen } from "@/domain/interview";
import { isAssessmentStatus } from "@/domain/assessment";
import { calendarDateInZone } from "@/domain/referral";

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
  const versionChoices = listVersionChoices(database, tenant);
  const versionNames = versionDisplayNames(database, tenant);
  const defaultAppliedOn = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const linkedContacts = listOpportunityContacts(database, tenant, row.id);
  const linkedIds = new Set(linkedContacts.map((item) => item.contactId));
  const allContacts = listContacts(database, tenant);
  const linkableContacts = allContacts
    .filter((item) => !linkedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      companyName: item.companyName,
    }));
  const asOfOn = calendarDateInZone(timeZone);
  const referrals = listReferrals(database, tenant, {
    asOfOn,
    opportunityId: row.id,
  });
  const attachedTags = listEntityTags(database, tenant, "opportunity", row.id);
  const workspaceTags = listTags(database, tenant).map((item) => item.label);
  const activity = listActivity(database, tenant, {
    timeZone,
    entityType: "opportunity",
    entityId: row.id,
  });
  const interviews = listInterviews(database, tenant, row.id);
  const assessments = listAssessments(database, tenant, row.id);
  const applicationChoices = row.application
    ? [{ id: row.application.id, label: `${row.companyName} application` }]
    : [];
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
    [
      "Resume version used",
      row.resumeVersionId === null
        ? null
        : (versionNames.get(row.resumeVersionId) ?? row.resumeVersionId),
    ],
    ["Next action", row.nextAction],
    ["Next action due", row.nextActionDue],
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
        aria-labelledby="opportunity-referrals"
        className="detail-section"
      >
        <h2 id="opportunity-referrals">Referral requests</h2>
        <ReferralCollection
          empty="No referral requests for this opening yet."
          labelledBy="opportunity-referrals"
          rows={referrals}
        />
        {allContacts.length === 0 ? (
          <p className="section-empty">
            Add a contact before asking for a referral.
          </p>
        ) : (
          <ReferralCreateForm
            contacts={allContacts.map(({ id: contactId, name }) => ({
              id: contactId,
              name,
            }))}
            defaultOpportunityId={row.id}
            defaultRequestedOn={asOfOn}
            defaultStage="requested"
            opportunities={[
              {
                id: row.id,
                role: row.role,
                companyName: row.companyName,
              },
            ]}
          />
        )}
      </section>
      <section
        aria-labelledby="application-heading"
        className="detail-section application-block"
        id="application"
      >
        <h2 id="application-heading">Application</h2>
        {row.application ? (
          <ApplicationEditForm
            application={row.application}
            versions={versionChoices}
          />
        ) : (
          <MarkAppliedForm
            defaultAppliedOn={defaultAppliedOn}
            opportunityId={row.id}
            versions={versionChoices}
          />
        )}
      </section>
      <section
        aria-labelledby="assessments-heading"
        className="detail-section"
        id="assessments"
      >
        <h2 id="assessments-heading">Assessments</h2>
        {assessments.length === 0 ? (
          <p className="section-empty">
            No assessments yet. A recruiter-sourced assessment is valid before an
            application exists.
          </p>
        ) : (
          <>
            <div className="table-scroll assessment-table-wrap">
              <table className="tbl assessment-table">
                <thead>
                  <tr>
                    <th scope="col">Kind</th>
                    <th scope="col">Platform</th>
                    <th scope="col">Window</th>
                    <th scope="col">Deadline</th>
                    <th scope="col">Status</th>
                    <th scope="col">Application</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((item) => (
                    <tr key={item.id}>
                      <td>{item.kind}</td>
                      <td>{item.platform ?? "—"}</td>
                      <td className="tnum">{item.windowLabel}</td>
                      <td className="tnum">{item.whenLabel}</td>
                      <td>
                        {isAssessmentStatus(item.status) ? (
                          <AssessmentStatusChip status={item.status} />
                        ) : (
                          item.status
                        )}
                      </td>
                      <td>
                        {item.applicationId ? "Linked application" : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="Assessments" className="assessment-card-list">
              {assessments.map((item) => (
                <li className="assessment-list-card" key={item.id}>
                  <span className="assessment-list-card__heading">
                    <strong>
                      {item.kind}
                      {item.platform ? ` · ${item.platform}` : ""}
                    </strong>
                    {isAssessmentStatus(item.status) ? (
                      <AssessmentStatusChip status={item.status} />
                    ) : null}
                  </span>
                  <span className="tnum">{item.whenLabel}</span>
                  <span>
                    {item.applicationId
                      ? "Linked application"
                      : "No linked application"}
                  </span>
                </li>
              ))}
            </ul>
            {assessments.map((item) => {
              const when = formatInterviewWhen(item.dueAt, timeZone);
              return (
                <AssessmentEditForm
                  applications={applicationChoices}
                  key={item.id}
                  row={{
                    id: item.id,
                    kind: item.kind,
                    platform: item.platform,
                    dateOn: when.dateOn,
                    time: when.time,
                    durationMinutes: item.durationMinutes,
                    status: isAssessmentStatus(item.status)
                      ? item.status
                      : "invited",
                    result: item.result,
                    notes: item.notes,
                    applicationId: item.applicationId,
                  }}
                />
              );
            })}
          </>
        )}
        <AssessmentAddForm
          applications={applicationChoices}
          defaultDateOn={asOfOn}
          opportunityId={row.id}
        />
      </section>
      <section
        aria-labelledby="interviews-heading"
        className="detail-section"
        id="interviews"
      >
        <h2 id="interviews-heading">Interviews</h2>
        {interviews.length === 0 ? (
          <p className="section-empty">No interview rounds yet. Add the first one below.</p>
        ) : (
          <>
            <div className="table-scroll interview-table-wrap">
              <table className="tbl interview-table">
                <thead>
                  <tr>
                    <th scope="col">Round</th>
                    <th scope="col">Type</th>
                    <th scope="col">When</th>
                    <th scope="col">Interviewer</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {interviews.map((item) => (
                    <tr key={item.id}>
                      <td className="tnum">{item.roundIndex}</td>
                      <td>{item.kind}</td>
                      <td className="tnum">{item.whenLabel}</td>
                      <td>{item.interviewer ?? "—"}</td>
                      <td>{item.result ?? "Pending"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul aria-label="Interview rounds" className="interview-card-list">
              {interviews.map((item) => (
                <li className="interview-list-card" key={item.id}>
                  <span className="interview-list-card__heading">
                    <strong>
                      Round {item.roundIndex} · {item.kind}
                    </strong>
                  </span>
                  <span className="tnum">{item.whenLabel}</span>
                  <span>{item.interviewer ?? "No interviewer named"}</span>
                  <span>{item.result ?? "Pending"}</span>
                </li>
              ))}
            </ul>
            {interviews.map((item) => {
              const when = formatInterviewWhen(item.at, timeZone);
              return (
                <InterviewEditForm
                  key={item.id}
                  round={{
                    id: item.id,
                    kind: item.kind,
                    dateOn: when.dateOn,
                    time: when.time,
                    interviewer: item.interviewer,
                    meetingUrl: item.meetingUrl,
                    questions: item.questions,
                    prepNotes: item.prepNotes,
                    performance: item.performance,
                    result: item.result,
                    notes: item.notes,
                  }}
                />
              );
            })}
          </>
        )}
        <InterviewAddForm defaultDateOn={asOfOn} opportunityId={row.id} />
      </section>
      <section aria-labelledby="opportunity-tags" className="detail-section">
        <h2 id="opportunity-tags">Tags</h2>
        <TagPicker
          attached={attachedTags}
          entityId={row.id}
          entityType="opportunity"
          workspaceLabels={workspaceTags}
        />
      </section>
      <section aria-labelledby="opportunity-activity" className="detail-section">
        <h2 id="opportunity-activity">Activity</h2>
        <ActivityTimeline
          empty="No activity recorded yet."
          items={activity}
          timeZone={timeZone}
          todayOn={asOfOn}
        />
      </section>
      <section aria-labelledby="edit-opportunity" className="detail-section">
        <h2 id="edit-opportunity">Edit opportunity</h2>
        <OpportunityEditForm companies={companies} opportunity={row} />
      </section>
    </article>
  );
}
