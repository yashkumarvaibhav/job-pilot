import Link from "next/link";
import type { ReactNode } from "react";

import { Reply } from "lucide-react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { ContactEditForm } from "@/components/contact-form";
import {
  contactMethodKindLabel,
  ContactStatusChip,
  relationshipLabel,
} from "@/components/contact-status";
import { InteractionChannelMark } from "@/components/interaction-channel";
import {
  InteractionLogForm,
  MarkRepliedButton,
} from "@/components/interaction-form";
import { FromConversationPanel } from "@/components/opportunity-contact-forms";
import { ReferralCreateForm } from "@/components/referral-forms";
import { ReferralCollection } from "@/components/referral-list";
import { TagPicker } from "@/components/tag-picker";
import { RolledUpStageChip } from "@/components/application-status";
import {
  formatInteractionOccurredAt,
  interactionDirectionLabel,
} from "@/domain/interaction";
import { requireTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { listCompanies } from "@/server/repos/companies";
import { getContact } from "@/server/repos/contacts";
import { listInteractions } from "@/server/repos/interactions";
import { listContactOpportunities, listOpportunities } from "@/server/repos/opportunities";
import { listReferrals } from "@/server/repos/referrals";
import { listEntityTags, listTags } from "@/server/repos/tags";
import { listActivity } from "@/server/repos/activity";
import { calendarDateInZone } from "@/domain/referral";

type ContactDetailPageProps = { params: Promise<{ id: string }> };

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "Not set"}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: ContactDetailPageProps) {
  const tenant = await requireTenant();
  const database = getDatabase();
  const { id } = await params;
  const contact = getContact(database, tenant, id);

  if (!contact) {
    return (
      <section className="data-state data-state--error contact-not-found">
        <p className="eyebrow">Not found</p>
        <h1>Contact not found</h1>
        <p>This contact does not exist in your workspace.</p>
        <Link className="btn btn--ghost" href="/contacts">
          Back to contacts
        </Link>
      </section>
    );
  }

  const companies = listCompanies(database, tenant);
  const interactions = listInteractions(database, tenant, {
    contactId: contact.id,
  });
  const linkedOpportunities = listContactOpportunities(
    database,
    tenant,
    contact.id,
  );
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const referrals = listReferrals(database, tenant, {
    asOfOn,
    contactId: contact.id,
  });
  const opportunityOptions = listOpportunities(database, tenant, "all").map(
    (row) => ({
      id: row.id,
      role: row.role,
      companyName: row.companyName,
    }),
  );
  const attachedTags = listEntityTags(database, tenant, "contact", contact.id);
  const workspaceTags = listTags(database, tenant).map((row) => row.label);
  const activity = listActivity(database, tenant, {
    timeZone,
    entityType: "contact",
    entityId: contact.id,
  });
  return (
    <article className="contact-detail">
      <Link className="back-link" href="/contacts">
        <span aria-hidden="true">←</span> Contacts
      </Link>

      <header className="detail-header">
        <div>
          <p className="eyebrow">Contact</p>
          <h1>{contact.name}</h1>
        </div>
        <ContactStatusChip status={contact.networkingStatus} />
      </header>

      <section aria-labelledby="contact-identity" className="detail-section">
        <h2 id="contact-identity">Contact details</h2>
        <dl className="contact-field-grid">
          <Field
            label="Company"
            value={
              contact.companyId && contact.companyName ? (
                <Link className="detail-link" href={`/companies/${contact.companyId}`}>
                  {contact.companyName}
                </Link>
              ) : (
                "No company"
              )
            }
          />
          <Field label="Designation" value={contact.designation} />
          <Field label="Relationship" value={relationshipLabel(contact.relationship)} />
          <Field label="Location" value={contact.location} />
          <Field label="Source" value={contact.source} />
          <Field
            label="Preferred channel"
            value={
              contact.preferredContactChannel
                ? contactMethodKindLabel(contact.preferredContactChannel)
                : null
            }
          />
          <Field label="Next action" value={contact.nextAction} />
          <Field
            label="Follow-up date"
            value={
              contact.followUpOn ? (
                <span className="tnum">{contact.followUpOn}</span>
              ) : null
            }
          />
          <Field label="Notes" value={contact.notes} />
        </dl>
      </section>

      <section aria-labelledby="contact-tags" className="detail-section">
        <h2 id="contact-tags">Tags</h2>
        <TagPicker
          attached={attachedTags}
          entityId={contact.id}
          entityType="contact"
          workspaceLabels={workspaceTags}
        />
      </section>

      <section aria-labelledby="contact-methods" className="detail-section">
        <h2 id="contact-methods">Contact methods</h2>
        {contact.methods.length === 0 ? (
          <p className="section-empty">No contact methods saved.</p>
        ) : (
          <ul className="contact-method-list">
            {contact.methods.map((method) => (
              <li key={method.id}>
                <span>{contactMethodKindLabel(method.kind)}</span>
                <strong>{method.value}</strong>
                {method.isPrimary ? <small>Primary</small> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="from-conversation"
        className="detail-section from-conversation-section"
      >
        <h2 id="from-conversation">Create from conversation</h2>
        <FromConversationPanel
          companies={companies.map(({ id: companyOptionId, name }) => ({
            id: companyOptionId,
            name,
          }))}
          companyId={contact.companyId}
          companyName={contact.companyName}
          contactId={contact.id}
          hasRecordedOpening={interactions.length > 0}
        />
      </section>

      <section aria-labelledby="log-interaction" className="detail-section">
        <h2 id="log-interaction">Log interaction</h2>
        <p className="field-hint">
          Record a WhatsApp, LinkedIn note, or email. Nothing here is sent.
        </p>
        <InteractionLogForm contactId={contact.id} />
      </section>

      <section aria-labelledby="contact-timeline" className="detail-section">
        <h2 id="contact-timeline">Interaction timeline</h2>
        {interactions.length === 0 ? (
          <p className="section-empty">
            No interactions yet. Log a WhatsApp, a LinkedIn note, or an email.
          </p>
        ) : (
          <ol className="interaction-timeline">
            {interactions.map((row) => {
              const needsReply =
                row.requiresReply && row.replyResolvedAt === null;
              return (
                <li key={row.id}>
                  <div className="interaction-timeline__meta">
                    <InteractionChannelMark channel={row.channel} />
                    <span className="interaction-direction">
                      {interactionDirectionLabel(row.direction)}
                    </span>
                    <time className="tnum" dateTime={row.occurredAt.toISOString()}>
                      {formatInteractionOccurredAt(row.occurredAt, timeZone)}
                    </time>
                  </div>
                  {row.body ? <p>{row.body}</p> : null}
                  {needsReply ? (
                    <div className="interaction-need-reply">
                      <span className="chip contact-status-chip" data-tone="warning">
                        <Reply aria-hidden="true" />
                        Needs my reply
                      </span>
                      <MarkRepliedButton
                        contactId={contact.id}
                        interactionId={row.id}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="contact-activity" className="detail-section">
        <h2 id="contact-activity">Activity</h2>
        <ActivityTimeline
          empty="No activity recorded yet."
          items={activity}
          timeZone={timeZone}
          todayOn={asOfOn}
        />
      </section>

      <section
        aria-labelledby="linked-opportunities"
        className="detail-section"
      >
        <h2 id="linked-opportunities">Linked opportunities</h2>
        {linkedOpportunities.length === 0 ? (
          <p className="section-empty">
            No opportunities linked yet. Create one from this conversation when
            an opening is logged.
          </p>
        ) : (
          <>
            <div className="table-scroll opportunity-table-wrap">
              <table className="tbl opportunity-table">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Role</th>
                    <th scope="col">Job ID</th>
                    <th scope="col">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedOpportunities.map((row) => (
                    <tr key={row.id}>
                      <td>{row.companyName}</td>
                      <td>
                        <Link
                          className="table-link"
                          href={`/opportunities/${row.id}`}
                        >
                          {row.role}
                        </Link>
                      </td>
                      <td className="tnum mono-value">{row.jobId ?? "—"}</td>
                      <td>
                        <RolledUpStageChip
                          applicationStage={row.application?.stage}
                          opportunityStage={row.stage}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul
              aria-label="Linked opportunities"
              className="opportunity-card-list"
            >
              {linkedOpportunities.map((row) => (
                <li key={row.id}>
                  <Link
                    className="opportunity-list-card"
                    href={`/opportunities/${row.id}`}
                  >
                    <span className="opportunity-list-card__heading">
                      <strong>{row.role}</strong>
                    </span>
                    <span>
                      {row.companyName}
                      {row.jobId ? ` · ${row.jobId}` : ""}
                    </span>
                    <RolledUpStageChip
                      applicationStage={row.application?.stage}
                      opportunityStage={row.stage}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section
        aria-labelledby="contact-referrals"
        className="detail-section"
      >
        <h2 id="contact-referrals">Referral requests</h2>
        <ReferralCollection
          empty="No referral requests for this person yet."
          labelledBy="contact-referrals"
          rows={referrals}
        />
        <ReferralCreateForm
          contacts={[{ id: contact.id, name: contact.name }]}
          defaultContactId={contact.id}
          defaultRequestedOn={asOfOn}
          defaultStage="requested"
          opportunities={opportunityOptions}
        />
      </section>

      <section aria-labelledby="edit-contact" className="detail-section">
        <h2 id="edit-contact">Edit contact</h2>
        <ContactEditForm
          companies={companies}
          contact={{
            id: contact.id,
            companyId: contact.companyId,
            name: contact.name,
            designation: contact.designation,
            relationship: contact.relationship,
            source: contact.source,
            location: contact.location,
            notes: contact.notes,
            tags: contact.tagsJson,
            preferredContactChannel: contact.preferredContactChannel,
            networkingStatus: contact.networkingStatus,
            nextAction: contact.nextAction,
            followUpOn: contact.followUpOn,
            methods: contact.methods.map(({ kind, value, isPrimary }) => ({
              kind,
              value,
              isPrimary,
            })),
          }}
        />
      </section>
    </article>
  );
}
