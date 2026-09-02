"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  APPLICATION_STAGES,
  OFFER_DECISIONS,
  type ApplicationStage,
} from "@/domain/application";
import { DOCUMENT_NO_VERSION_LABEL } from "@/domain/document";

export type VersionChoice = { id: string; displayName: string };

/**
 * §39: an application records exactly which stored version it used, so this is a
 * picker over real versions, never a typed label. With nothing uploaded yet the
 * control says so instead of pretending to be a text field.
 */
function VersionPicker({
  disabled,
  id,
  selectedId,
  versions,
}: {
  disabled: boolean;
  id: string;
  selectedId?: string | null;
  versions: readonly VersionChoice[];
}) {
  if (versions.length === 0) {
    return (
      <p className="field-hint" id={`${id}-empty`}>
        No document versions yet. Upload one in{" "}
        <a href="/settings/documents">Settings → Documents</a> to record which
        resume you used.
      </p>
    );
  }

  return (
    <select
      defaultValue={selectedId ?? ""}
      disabled={disabled}
      id={id}
      name="resumeVersionId"
    >
      <option value="">{DOCUMENT_NO_VERSION_LABEL}</option>
      {versions.map((version) => (
        <option key={version.id} value={version.id}>
          {version.displayName}
        </option>
      ))}
    </select>
  );
}

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function MarkAppliedForm({
  defaultAppliedOn,
  opportunityId,
  versions = [],
}: {
  defaultAppliedOn: string;
  opportunityId: string;
  versions?: readonly VersionChoice[];
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      opportunityId,
      portal: String(form.get("portal") ?? ""),
      appliedOn: String(form.get("appliedOn") ?? ""),
      applicationExternalId: String(form.get("applicationExternalId") ?? ""),
      referrer: String(form.get("referrer") ?? ""),
      resumeVersionId: String(form.get("resumeVersionId") ?? ""),
    };

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not mark this job as applied."));
        return;
      }
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="application-form" onSubmit={submit}>
      <div className="application-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-portal`}>Portal</label>
          <input
            disabled={pending}
            id={`${formId}-portal`}
            name="portal"
            required
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-applied`}>Applied date</label>
          <input
            defaultValue={defaultAppliedOn}
            disabled={pending}
            id={`${formId}-applied`}
            name="appliedOn"
            required
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-external`}>Application ID</label>
          <input
            disabled={pending}
            id={`${formId}-external`}
            name="applicationExternalId"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-referrer`}>Referrer</label>
          <input
            disabled={pending}
            id={`${formId}-referrer`}
            name="referrer"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-resume`}>Resume version used</label>
          <VersionPicker
            disabled={pending}
            id={`${formId}-resume`}
            versions={versions}
          />
        </div>
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Saving…" : "Mark applied"}
      </button>
    </form>
  );
}

export function ApplicationEditForm({
  application,
  versions = [],
}: {
  versions?: readonly VersionChoice[];
  application: {
    id: string;
    portal: string;
    appliedOn: string;
    applicationExternalId: string | null;
    referrer: string | null;
    resumeVersionId: string | null;
    notes: string | null;
    stage: ApplicationStage;
    offerDeadlineOn: string | null;
    offerDecision: string | null;
  };
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      portal: String(form.get("portal") ?? ""),
      appliedOn: String(form.get("appliedOn") ?? ""),
      applicationExternalId: String(form.get("applicationExternalId") ?? ""),
      referrer: String(form.get("referrer") ?? ""),
      resumeVersionId: String(form.get("resumeVersionId") ?? ""),
      notes: String(form.get("notes") ?? ""),
      stage: String(form.get("stage") ?? ""),
      offerDeadlineOn: String(form.get("offerDeadlineOn") ?? ""),
      offerDecision: String(form.get("offerDecision") ?? ""),
    };

    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(
          responseError(body, "Could not update this application."),
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
    <form aria-busy={pending} className="application-form" onSubmit={submit}>
      <div className="application-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-portal`}>Portal</label>
          <input
            defaultValue={application.portal}
            disabled={pending}
            id={`${formId}-portal`}
            name="portal"
            required
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-applied`}>Applied date</label>
          <input
            defaultValue={application.appliedOn}
            disabled={pending}
            id={`${formId}-applied`}
            name="appliedOn"
            required
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-external`}>Application ID</label>
          <input
            defaultValue={application.applicationExternalId ?? ""}
            disabled={pending}
            id={`${formId}-external`}
            name="applicationExternalId"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-referrer`}>Referrer</label>
          <input
            defaultValue={application.referrer ?? ""}
            disabled={pending}
            id={`${formId}-referrer`}
            name="referrer"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-resume`}>Resume version used</label>
          <VersionPicker
            disabled={pending}
            id={`${formId}-resume`}
            selectedId={application.resumeVersionId}
            versions={versions}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-stage`}>Application stage</label>
          <select
            defaultValue={application.stage}
            disabled={pending}
            id={`${formId}-stage`}
            name="stage"
          >
            {APPLICATION_STAGES.map((stage) => (
              <option key={stage.value} value={stage.value}>
                {stage.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-offer-deadline`}>Offer deadline</label>
          <input
            className="tnum"
            defaultValue={application.offerDeadlineOn ?? ""}
            disabled={pending}
            id={`${formId}-offer-deadline`}
            name="offerDeadlineOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-offer-decision`}>Offer decision</label>
          <select
            defaultValue={application.offerDecision ?? ""}
            disabled={pending}
            id={`${formId}-offer-decision`}
            name="offerDecision"
          >
            <option value="">Not decided</option>
            {OFFER_DECISIONS.map((decision) => (
              <option key={decision.value} value={decision.value}>
                {decision.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${formId}-notes`}>Notes</label>
        <textarea
          defaultValue={application.notes ?? ""}
          disabled={pending}
          id={`${formId}-notes`}
          name="notes"
          rows={4}
        />
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Saving…" : "Save application"}
      </button>
      <p aria-live="polite" className="save-status">
        {saved ? "Application updated." : ""}
      </p>
    </form>
  );
}
