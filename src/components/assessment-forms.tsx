"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Ban, CheckCircle2, FileText, type LucideIcon } from "lucide-react";

import {
  ASSESSMENT_KIND_SUGGESTIONS,
  ASSESSMENT_PLATFORM_SUGGESTIONS,
  ASSESSMENT_STATUSES,
  assessmentStatusLabel,
  type AssessmentStatus,
} from "@/domain/assessment";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

const statusVisuals: Record<
  AssessmentStatus,
  { icon: LucideIcon; tone: "danger" | "info" | "muted" | "success" | "warning" }
> = {
  invited: { icon: FileText, tone: "warning" },
  completed: { icon: CheckCircle2, tone: "success" },
  cancelled: { icon: Ban, tone: "muted" },
};

export function AssessmentStatusChip({ status }: { status: AssessmentStatus }) {
  const { icon: Icon, tone } = statusVisuals[status];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {assessmentStatusLabel(status)}
    </span>
  );
}

function KindSuggestions({ listId }: { listId: string }) {
  return (
    <datalist id={listId}>
      {ASSESSMENT_KIND_SUGGESTIONS.map((kind) => (
        <option key={kind} value={kind} />
      ))}
    </datalist>
  );
}

function PlatformSuggestions({ listId }: { listId: string }) {
  return (
    <datalist id={listId}>
      {ASSESSMENT_PLATFORM_SUGGESTIONS.map((platform) => (
        <option key={platform} value={platform} />
      ))}
    </datalist>
  );
}

export function AssessmentAddForm({
  applications,
  defaultDateOn,
  opportunityId,
}: {
  applications: readonly { id: string; label: string }[];
  defaultDateOn: string;
  opportunityId: string;
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const dateOn = String(form.get("dateOn") ?? "");
    const time = String(form.get("time") ?? "");
    const payload = {
      opportunityId,
      kind: String(form.get("kind") ?? ""),
      platform: String(form.get("platform") ?? ""),
      dateOn: time ? dateOn : "",
      time,
      durationMinutes: String(form.get("durationMinutes") ?? ""),
      applicationId: String(form.get("applicationId") ?? ""),
      notes: String(form.get("notes") ?? ""),
    };

    try {
      const response = await fetch("/api/assessments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not add this assessment."));
        return;
      }
      formEl.reset();
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  const kindListId = `${formId}-kinds`;
  const platformListId = `${formId}-platforms`;

  return (
    <form aria-busy={pending} className="assessment-form" onSubmit={submit}>
      <div className="assessment-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-kind`}>Kind</label>
          <input
            disabled={pending}
            id={`${formId}-kind`}
            list={kindListId}
            name="kind"
            required
            type="text"
          />
          <KindSuggestions listId={kindListId} />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-platform`}>Platform</label>
          <input
            disabled={pending}
            id={`${formId}-platform`}
            list={platformListId}
            name="platform"
            type="text"
          />
          <PlatformSuggestions listId={platformListId} />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-date`}>Due date</label>
          <input
            className="tnum"
            defaultValue={defaultDateOn}
            disabled={pending}
            id={`${formId}-date`}
            name="dateOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-time`}>Due time</label>
          <input
            className="tnum"
            disabled={pending}
            id={`${formId}-time`}
            name="time"
            type="time"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-duration`}>Duration (minutes)</label>
          <input
            className="tnum"
            disabled={pending}
            id={`${formId}-duration`}
            min={1}
            name="durationMinutes"
            type="number"
          />
        </div>
        {applications.length > 0 ? (
          <div className="field">
            <label htmlFor={`${formId}-application`}>Linked application</label>
            <select
              disabled={pending}
              id={`${formId}-application`}
              name="applicationId"
            >
              <option value="">None — recruiter-sourced</option>
              {applications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field assessment-form-wide">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <textarea
            disabled={pending}
            id={`${formId}-notes`}
            name="notes"
            rows={2}
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
        {pending ? "Saving…" : "Add assessment"}
      </button>
    </form>
  );
}

export function AssessmentEditForm({
  applications,
  row,
}: {
  applications: readonly { id: string; label: string }[];
  row: {
    id: string;
    kind: string;
    platform: string | null;
    dateOn: string | null;
    time: string | null;
    durationMinutes: number | null;
    status: AssessmentStatus;
    result: string | null;
    notes: string | null;
    applicationId: string | null;
  };
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const kindListId = `${formId}-kinds`;
  const platformListId = `${formId}-platforms`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const dateOn = String(form.get("dateOn") ?? "");
    const time = String(form.get("time") ?? "");
    const payload = {
      kind: String(form.get("kind") ?? ""),
      platform: String(form.get("platform") ?? ""),
      dateOn: time ? dateOn : "",
      time,
      durationMinutes: String(form.get("durationMinutes") ?? ""),
      status: String(form.get("status") ?? ""),
      result: String(form.get("result") ?? ""),
      applicationId: String(form.get("applicationId") ?? ""),
      notes: String(form.get("notes") ?? ""),
    };

    try {
      const response = await fetch(
        `/api/assessments/${encodeURIComponent(row.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not save this assessment."));
        return;
      }
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/assessments/${encodeURIComponent(row.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 204) {
        const body: unknown = await response.json().catch(() => null);
        setMessage(responseError(body, "Could not delete this assessment."));
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
    <form
      aria-busy={pending}
      className="assessment-form assessment-form--edit"
      onSubmit={submit}
    >
      <div className="assessment-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-kind`}>Kind</label>
          <input
            defaultValue={row.kind}
            disabled={pending}
            id={`${formId}-kind`}
            list={kindListId}
            name="kind"
            required
            type="text"
          />
          <KindSuggestions listId={kindListId} />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-platform`}>Platform</label>
          <input
            defaultValue={row.platform ?? ""}
            disabled={pending}
            id={`${formId}-platform`}
            list={platformListId}
            name="platform"
            type="text"
          />
          <PlatformSuggestions listId={platformListId} />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-date`}>Due date</label>
          <input
            className="tnum"
            defaultValue={row.dateOn ?? ""}
            disabled={pending}
            id={`${formId}-date`}
            name="dateOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-time`}>Due time</label>
          <input
            className="tnum"
            defaultValue={row.time ?? ""}
            disabled={pending}
            id={`${formId}-time`}
            name="time"
            type="time"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-status`}>Status</label>
          <select
            defaultValue={row.status}
            disabled={pending}
            id={`${formId}-status`}
            name="status"
          >
            {ASSESSMENT_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-duration`}>Duration (minutes)</label>
          <input
            className="tnum"
            defaultValue={row.durationMinutes ?? ""}
            disabled={pending}
            id={`${formId}-duration`}
            min={1}
            name="durationMinutes"
            type="number"
          />
        </div>
        {applications.length > 0 ? (
          <div className="field">
            <label htmlFor={`${formId}-application`}>Linked application</label>
            <select
              defaultValue={row.applicationId ?? ""}
              disabled={pending}
              id={`${formId}-application`}
              name="applicationId"
            >
              <option value="">None — recruiter-sourced</option>
              {applications.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`${formId}-result`}>Result</label>
          <input
            defaultValue={row.result ?? ""}
            disabled={pending}
            id={`${formId}-result`}
            name="result"
            type="text"
          />
        </div>
        <div className="field assessment-form-wide">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <textarea
            defaultValue={row.notes ?? ""}
            disabled={pending}
            id={`${formId}-notes`}
            name="notes"
            rows={2}
          />
        </div>
      </div>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <div className="assessment-form-actions">
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save assessment"}
        </button>
        <button
          className="btn btn--ghost"
          disabled={pending}
          onClick={remove}
          type="button"
        >
          Delete assessment
        </button>
      </div>
    </form>
  );
}
