"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

type CompanyOption = { id: string; name: string };
type ContactOption = { id: string; name: string; companyName: string | null };

export function FromConversationPanel({
  companies,
  companyId,
  companyName,
  contactId,
  hasRecordedOpening,
}: {
  companies: CompanyOption[];
  companyId: string | null;
  companyName: string | null;
  contactId: string;
  hasRecordedOpening: boolean;
}) {
  const formId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const needsCompanyPicker = companyId === null;
  const canCreate =
    hasRecordedOpening && (!needsCompanyPicker || companies.length > 0);

  if (!hasRecordedOpening) {
    return (
      <div className="from-conversation">
        <button className="btn btn--ghost" disabled type="button">
          Create opportunity from conversation
        </button>
        <p className="field-hint">Log the opening first</p>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="from-conversation">
        <button className="btn btn--ghost" disabled type="button">
          Create opportunity from conversation
        </button>
        <p className="field-hint">Add a company before creating a job.</p>
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      contactId,
      role: String(form.get("role") ?? ""),
      jobId: String(form.get("jobId") ?? ""),
      companyId: String(form.get("companyId") ?? "") || null,
    };

    try {
      const response = await fetch("/api/opportunities/from-conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(
          responseError(
            body,
            "Could not create the opportunity. Check the fields and retry.",
          ),
        );
        return;
      }
      if (typeof body !== "object" || body === null || !("id" in body)) {
        setMessage(
          "The opportunity saved, but its response was incomplete. Reload the page.",
        );
        return;
      }
      router.push(`/opportunities/${(body as { id: string }).id}`);
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="from-conversation">
      <button
        aria-controls="from-conversation-form"
        aria-expanded={open}
        className="btn btn--ghost"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? "Cancel" : "Create opportunity from conversation"}
      </button>
      {open ? (
        <form
          aria-busy={pending}
          className="from-conversation__form"
          id="from-conversation-form"
          onSubmit={submit}
        >
          {needsCompanyPicker ? (
            <div className="field">
              <label htmlFor={`${formId}-company`}>Company</label>
              <select
                defaultValue=""
                disabled={pending}
                id={`${formId}-company`}
                name="companyId"
                required
              >
                <option disabled value="">
                  Choose a company
                </option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <input name="companyId" type="hidden" value={companyId} />
              <p className="field-hint">
                Company {companyName ?? "is already on this contact"}.
              </p>
            </>
          )}
          <div className="field">
            <label htmlFor={`${formId}-role`}>Role</label>
            <input
              disabled={pending}
              id={`${formId}-role`}
              name="role"
              required
              type="text"
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-jobId`}>Job ID</label>
            <input
              disabled={pending}
              id={`${formId}-jobId`}
              name="jobId"
              type="text"
            />
          </div>
          {message ? (
            <p className="form-alert" role="alert">
              <span aria-hidden="true">!</span>
              {message}
            </p>
          ) : null}
          <button className="btn" disabled={pending} type="submit">
            {pending ? "Creating…" : "Create opportunity"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function LinkContactForm({
  contacts,
  opportunityId,
}: {
  contacts: ContactOption[];
  opportunityId: string;
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (contacts.length === 0) {
    return (
      <p className="field-hint">
        Every contact is already linked, or none exist yet.
      </p>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const contactId = String(form.get("contactId") ?? "");

    try {
      const response = await fetch(
        `/api/opportunities/${opportunityId}/link-contact`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactId }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(
          responseError(body, "Could not link the contact. Retry."),
        );
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-busy={pending}
      className="link-contact-form"
      onSubmit={submit}
    >
      <div className="field">
        <label htmlFor={`${formId}-contact`}>Contact</label>
        <select
          defaultValue=""
          disabled={pending}
          id={`${formId}-contact`}
          name="contactId"
          required
        >
          <option disabled value="">
            Choose a contact
          </option>
          {contacts.map((row) => (
            <option key={row.id} value={row.id}>
              {row.companyName ? `${row.name} · ${row.companyName}` : row.name}
            </option>
          ))}
        </select>
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <p aria-live="polite" className="save-status">
        {saved ? "Contact linked." : ""}
      </p>
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Linking…" : "Link contact"}
      </button>
    </form>
  );
}
