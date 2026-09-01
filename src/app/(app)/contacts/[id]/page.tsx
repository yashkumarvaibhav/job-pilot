import Link from "next/link";
import type { ReactNode } from "react";

import { ContactEditForm } from "@/components/contact-form";
import {
  contactMethodKindLabel,
  ContactStatusChip,
  relationshipLabel,
} from "@/components/contact-status";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { listCompanies } from "@/server/repos/companies";
import { getContact } from "@/server/repos/contacts";

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
        {contact.tagsJson.length > 0 ? (
          <ul aria-label="Tags" className="contact-tag-list">
            {contact.tagsJson.map((tag) => (
              <li className="chip contact-tag" key={tag}>
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
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

      <section aria-labelledby="contact-timeline" className="detail-section">
        <h2 id="contact-timeline">Interaction timeline</h2>
        <p className="section-empty">
          No interactions yet. Log a WhatsApp, a LinkedIn note, or an email.
        </p>
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
