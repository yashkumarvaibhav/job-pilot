"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  CONTACT_METHOD_KINDS,
  CONTACT_RELATIONSHIPS,
  DO_NOT_CONTACT,
  NETWORKING_STATUSES,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "@/domain/contact";

export type ContactCompanyOption = { id: string; name: string };

export type ContactFormValues = {
  id: string;
  companyId: string | null;
  name: string;
  designation: string | null;
  relationship: ContactRelationship;
  source: string | null;
  location: string | null;
  notes: string | null;
  tags: string[];
  preferredContactChannel: ContactMethodKind | null;
  networkingStatus: NetworkingStatus;
  nextAction: string | null;
  followUpOn: string | null;
  methods: { kind: ContactMethodKind; value: string; isPrimary: boolean }[];
};

type ContactFormProps = {
  companies: ContactCompanyOption[];
  endpoint: string;
  initial?: ContactFormValues;
  method: "POST" | "PUT";
  onSaved: (contact: { id: string }) => void;
  submitLabel: string;
};

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Could not save the contact. Check the fields and retry.";
}

function initialMethod(
  initial: ContactFormValues | undefined,
  kind: ContactMethodKind,
) {
  return initial?.methods.find((method) => method.kind === kind)?.value ?? "";
}

function ContactForm({
  companies,
  endpoint,
  initial,
  method,
  onSaved,
  submitLabel,
}: ContactFormProps) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const preferred = String(form.get("preferredContactChannel") ?? "");
    const networkingStatus = String(
      form.get("networkingStatus") ?? "not_contacted",
    ) as NetworkingStatus;
    const methods = CONTACT_METHOD_KINDS.map(({ value: kind }) => ({
      kind,
      value: String(form.get(`method-${kind}`) ?? ""),
      isPrimary: preferred === kind,
    })).filter(({ value }) => value.trim().length > 0);
    const payload = {
      companyName: String(form.get("companyName") ?? ""),
      name: String(form.get("name") ?? ""),
      designation: String(form.get("designation") ?? ""),
      relationship: String(form.get("relationship") ?? "unknown_cold_contact"),
      source: String(form.get("source") ?? ""),
      location: String(form.get("location") ?? ""),
      notes: String(form.get("notes") ?? ""),
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      preferredContactChannel: preferred || null,
      networkingStatus,
      nextAction: String(form.get("nextAction") ?? ""),
      followUpOn: String(form.get("followUpOn") ?? ""),
      methods,
      ...(initial?.networkingStatus === DO_NOT_CONTACT &&
      networkingStatus !== DO_NOT_CONTACT
        ? { overrideDoNotContact: true }
        : {}),
    };

    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body));
        return;
      }
      if (typeof body !== "object" || body === null || !("id" in body)) {
        setMessage(
          "The contact saved, but its response was incomplete. Reload the page.",
        );
        return;
      }
      onSaved(body as { id: string });
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="contact-form" onSubmit={submit}>
      <div className="contact-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-name`}>Name</label>
          <input
            defaultValue={initial?.name ?? ""}
            disabled={pending}
            id={`${formId}-name`}
            name="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-company`}>Company</label>
          <input
            defaultValue={
              initial?.companyId
                ? (companies.find((company) => company.id === initial.companyId)
                    ?.name ?? "")
                : ""
            }
            disabled={pending}
            id={`${formId}-company`}
            list={`${formId}-company-options`}
            name="companyName"
          />
          <datalist id={`${formId}-company-options`}>
            {companies.map((company) => (
              <option key={company.id} value={company.name} />
            ))}
          </datalist>
          <p className="field-hint">
            Type a name. A new company is created if this workspace does not
            already have it.
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-designation`}>Designation</label>
          <input
            defaultValue={initial?.designation ?? ""}
            disabled={pending}
            id={`${formId}-designation`}
            name="designation"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-relationship`}>Relationship</label>
          <select
            defaultValue={initial?.relationship ?? "unknown_cold_contact"}
            disabled={pending}
            id={`${formId}-relationship`}
            name="relationship"
          >
            {CONTACT_RELATIONSHIPS.map((relationship) => (
              <option key={relationship.value} value={relationship.value}>
                {relationship.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-status`}>Networking status</label>
          <select
            defaultValue={initial?.networkingStatus ?? "not_contacted"}
            disabled={pending}
            id={`${formId}-status`}
            name="networkingStatus"
          >
            {NETWORKING_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-preferred`}>Preferred channel</label>
          <select
            defaultValue={initial?.preferredContactChannel ?? ""}
            disabled={pending}
            id={`${formId}-preferred`}
            name="preferredContactChannel"
          >
            <option value="">Not set</option>
            {CONTACT_METHOD_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-source`}>Source</label>
          <input
            defaultValue={initial?.source ?? ""}
            disabled={pending}
            id={`${formId}-source`}
            name="source"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-location`}>Location</label>
          <input
            defaultValue={initial?.location ?? ""}
            disabled={pending}
            id={`${formId}-location`}
            name="location"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-next-action`}>Next action</label>
          <input
            defaultValue={initial?.nextAction ?? ""}
            disabled={pending}
            id={`${formId}-next-action`}
            name="nextAction"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-follow-up`}>Follow-up date</label>
          <input
            className="tnum"
            defaultValue={initial?.followUpOn ?? ""}
            disabled={pending}
            id={`${formId}-follow-up`}
            name="followUpOn"
            type="date"
          />
        </div>
        <div className="field contact-form-wide">
          <label htmlFor={`${formId}-tags`}>Tags</label>
          <input
            defaultValue={initial?.tags.join(", ") ?? ""}
            disabled={pending}
            id={`${formId}-tags`}
            name="tags"
            placeholder="Dream Company, Alumni Available…"
          />
        </div>
      </div>

      <fieldset className="contact-method-fields">
        <legend>Contact methods</legend>
        <div className="contact-form-grid">
          {CONTACT_METHOD_KINDS.map((kind) => (
            <div className="field" key={kind.value}>
              <label htmlFor={`${formId}-method-${kind.value}`}>
                {kind.label}
              </label>
              <input
                defaultValue={initialMethod(initial, kind.value)}
                disabled={pending}
                id={`${formId}-method-${kind.value}`}
                inputMode={
                  kind.value === "email"
                    ? "email"
                    : kind.value === "phone" || kind.value === "whatsapp"
                      ? "tel"
                      : "text"
                }
                name={`method-${kind.value}`}
                type={
                  kind.value === "email"
                    ? "email"
                    : kind.value === "linkedin"
                      ? "url"
                      : "text"
                }
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <textarea
          defaultValue={initial?.notes ?? ""}
          disabled={pending}
          id={`${formId}-notes`}
          name="notes"
          rows={4}
        />
      </div>

      {initial?.networkingStatus === DO_NOT_CONTACT ? (
        <p className="field-hint">
          Saving a different status is the explicit override required to leave
          Do Not Contact.
        </p>
      ) : null}

      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

export function ContactCreatePanel({
  companies,
}: {
  companies: ContactCompanyOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="contact-create-panel">
      <button
        aria-controls="new-contact-form"
        aria-expanded={open}
        className={open ? "btn btn--ghost" : "btn"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "Cancel" : "Add contact"}
      </button>
      {open ? (
        <section className="card contact-form-card" id="new-contact-form">
          <h2>Add contact</h2>
          <p>Networking can start before a job or even a company is known.</p>
          <ContactForm
            companies={companies}
            endpoint="/api/contacts"
            method="POST"
            onSaved={(created) => router.push(`/contacts/${created.id}`)}
            submitLabel="Save contact"
          />
        </section>
      ) : null}
    </div>
  );
}

export function ContactEditForm({
  companies,
  contact,
}: {
  companies: ContactCompanyOption[];
  contact: ContactFormValues;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <div className="card contact-form-card contact-form-card--edit">
      <ContactForm
        companies={companies}
        endpoint={`/api/contacts/${contact.id}`}
        initial={contact}
        method="PUT"
        onSaved={() => {
          setSaved(true);
          router.refresh();
        }}
        submitLabel="Save changes"
      />
      <p aria-live="polite" className="save-status">
        {saved ? "Contact updated." : ""}
      </p>
    </div>
  );
}
