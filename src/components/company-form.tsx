"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { DuplicateWarning } from "@/components/duplicate-warning";
import {
  parseDuplicateConflict,
  type DuplicateConflict,
} from "@/domain/duplicate";
import type { Company } from "@/server/repos/companies";

type CompanyFormValues = Pick<
  Company,
  | "name"
  | "website"
  | "careersUrl"
  | "industry"
  | "type"
  | "locations"
  | "target"
  | "notes"
  | "nextAction"
  | "nextActionDue"
>;

type CompanyFormProps = {
  endpoint: string;
  method: "POST" | "PUT";
  initial?: CompanyFormValues;
  submitLabel: string;
  onSaved: (company: { id: string }) => void;
};

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Could not save the company. Check the fields and retry.";
}

function CompanyForm({
  endpoint,
  method,
  initial,
  submitLabel,
  onSaved,
}: CompanyFormProps) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DuplicateConflict | null>(null);
  const [pendingPayload, setPendingPayload] = useState<Record<
    string,
    unknown
  > | null>(null);

  async function save(
    payload: Record<string, unknown>,
    acknowledgeDuplicates = false,
  ) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          acknowledgeDuplicates
            ? { ...payload, acknowledgeDuplicates: true }
            : payload,
        ),
      });
      const body: unknown = await response.json();
      const duplicate = parseDuplicateConflict(response.status, body);
      if (duplicate) {
        setConflict(duplicate);
        setPendingPayload(payload);
        return;
      }

      if (!response.ok) {
        setMessage(responseError(body));
        return;
      }

      if (typeof body !== "object" || body === null || !("id" in body)) {
        setMessage(
          "The company saved, but its response was incomplete. Reload the page.",
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

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConflict(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      website: String(form.get("website") ?? ""),
      careersUrl: String(form.get("careersUrl") ?? ""),
      industry: String(form.get("industry") ?? ""),
      type: String(form.get("type") ?? ""),
      locations: String(form.get("locations") ?? ""),
      target: form.get("target") === "on",
      notes: String(form.get("notes") ?? ""),
      nextAction: String(form.get("nextAction") ?? ""),
      nextActionDue: String(form.get("nextActionDue") ?? ""),
    };
    await save(payload);
  }

  return (
    <form aria-busy={pending} className="company-form" onSubmit={submit}>
      <div className="company-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-name`}>Company name</label>
          <input
            defaultValue={initial?.name ?? ""}
            disabled={pending}
            id={`${formId}-name`}
            name="name"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-industry`}>Industry</label>
          <input
            defaultValue={initial?.industry ?? ""}
            disabled={pending}
            id={`${formId}-industry`}
            name="industry"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-website`}>Website</label>
          <input
            defaultValue={initial?.website ?? ""}
            disabled={pending}
            id={`${formId}-website`}
            inputMode="url"
            name="website"
            placeholder="https://example.com"
            type="url"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-careers`}>Careers URL</label>
          <input
            defaultValue={initial?.careersUrl ?? ""}
            disabled={pending}
            id={`${formId}-careers`}
            inputMode="url"
            name="careersUrl"
            placeholder="https://example.com/careers"
            type="url"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-type`}>Company type</label>
          <input
            defaultValue={initial?.type ?? ""}
            disabled={pending}
            id={`${formId}-type`}
            name="type"
            placeholder="Product, services, startup…"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-locations`}>Locations</label>
          <input
            defaultValue={initial?.locations ?? ""}
            disabled={pending}
            id={`${formId}-locations`}
            name="locations"
            placeholder="Bengaluru, Hyderabad"
          />
        </div>
      </div>

      <label className="checkbox-field" htmlFor={`${formId}-target`}>
        <input
          defaultChecked={initial?.target ?? false}
          disabled={pending}
          id={`${formId}-target`}
          name="target"
          type="checkbox"
        />
        <span>Mark as a target company</span>
      </label>

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

      <div className="company-form-grid">
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
          <label htmlFor={`${formId}-next-action-due`}>Next action due</label>
          <input
            className="tnum"
            defaultValue={initial?.nextActionDue ?? ""}
            disabled={pending}
            id={`${formId}-next-action-due`}
            name="nextActionDue"
            type="date"
          />
        </div>
      </div>

      {conflict ? (
        <DuplicateWarning
          conflict={conflict}
          pending={pending}
          onCancel={() => {
            setConflict(null);
            setPendingPayload(null);
          }}
          onCreateAnyway={() => {
            if (pendingPayload) void save(pendingPayload, true);
          }}
        />
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

export function TargetChip() {
  return (
    <span className="chip target-chip">
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="m12 3 2.6 5.3 5.9.8-4.2 4.1 1 5.8-5.3-2.8L6.7 19l1-5.8-4.2-4.1 5.9-.8Z" />
      </svg>
      Target
    </span>
  );
}

export function CompanyCreatePanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <div className="company-create-panel">
      <button
        aria-controls="new-company-form"
        aria-expanded={open}
        className={open ? "btn btn--ghost" : "btn"}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "Cancel" : "Add company"}
      </button>
      {open ? (
        <section className="card company-form-card" id="new-company-form">
          <h2>Add company</h2>
          <p>Start with the organisation. Contacts and roles can attach later.</p>
          <CompanyForm
            endpoint="/api/companies"
            method="POST"
            onSaved={(created) => router.push(`/companies/${created.id}`)}
            submitLabel="Save company"
          />
        </section>
      ) : null}
    </div>
  );
}

export function CompanyEditForm({
  company,
}: {
  company: CompanyFormValues & { id: string };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  return (
    <div className="card company-form-card company-form-card--edit">
      <CompanyForm
        endpoint={`/api/companies/${company.id}`}
        initial={company}
        method="PUT"
        onSaved={() => {
          setSaved(true);
          router.refresh();
        }}
        submitLabel="Save changes"
      />
      <p aria-live="polite" className="save-status">
        {saved ? "Company updated." : ""}
      </p>
    </div>
  );
}
