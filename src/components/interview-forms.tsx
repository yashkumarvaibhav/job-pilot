"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  INTERVIEW_KIND_SUGGESTIONS,
} from "@/domain/interview";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function KindSuggestions({ listId }: { listId: string }) {
  return (
    <datalist id={listId}>
      {INTERVIEW_KIND_SUGGESTIONS.map((kind) => (
        <option key={kind} value={kind} />
      ))}
    </datalist>
  );
}

export function InterviewAddForm({
  defaultDateOn,
  opportunityId,
}: {
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
        dateOn: time ? dateOn : "",
        time,
        interviewer: String(form.get("interviewer") ?? ""),
        meetingUrl: String(form.get("meetingUrl") ?? ""),
        notes: String(form.get("notes") ?? ""),
      };

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not add this interview round."));
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

  return (
    <form aria-busy={pending} className="interview-form" onSubmit={submit}>
      <div className="interview-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-kind`}>Round type</label>
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
          <label htmlFor={`${formId}-interviewer`}>Interviewer</label>
          <input
            disabled={pending}
            id={`${formId}-interviewer`}
            name="interviewer"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-date`}>Date</label>
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
          <label htmlFor={`${formId}-time`}>Time</label>
          <input
            className="tnum"
            disabled={pending}
            id={`${formId}-time`}
            name="time"
            type="time"
          />
        </div>
        <div className="field interview-form-wide">
          <label htmlFor={`${formId}-meeting`}>Meeting link</label>
          <input
            disabled={pending}
            id={`${formId}-meeting`}
            name="meetingUrl"
            type="url"
          />
        </div>
        <div className="field interview-form-wide">
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
        {pending ? "Saving…" : "Add interview"}
      </button>
    </form>
  );
}

export function InterviewEditForm({
  round,
}: {
  round: {
    id: string;
    kind: string;
    dateOn: string | null;
    time: string | null;
    interviewer: string | null;
    meetingUrl: string | null;
    questions: string | null;
    prepNotes: string | null;
    performance: string | null;
    result: string | null;
    notes: string | null;
  };
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const kindListId = `${formId}-kinds`;

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
        dateOn: time ? dateOn : "",
        time,
        interviewer: String(form.get("interviewer") ?? ""),
        meetingUrl: String(form.get("meetingUrl") ?? ""),
        questions: String(form.get("questions") ?? ""),
        prepNotes: String(form.get("prepNotes") ?? ""),
        performance: String(form.get("performance") ?? ""),
        result: String(form.get("result") ?? ""),
        notes: String(form.get("notes") ?? ""),
      };

    try {
      const response = await fetch(`/api/interviews/${encodeURIComponent(round.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not save this interview round."));
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
      const response = await fetch(`/api/interviews/${encodeURIComponent(round.id)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const body: unknown = await response.json().catch(() => null);
        setMessage(responseError(body, "Could not delete this interview round."));
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
    <form aria-busy={pending} className="interview-form interview-form--edit" onSubmit={submit}>
      <div className="interview-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-kind`}>Round type</label>
          <input
            defaultValue={round.kind}
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
          <label htmlFor={`${formId}-interviewer`}>Interviewer</label>
          <input
            defaultValue={round.interviewer ?? ""}
            disabled={pending}
            id={`${formId}-interviewer`}
            name="interviewer"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-date`}>Date</label>
          <input
            className="tnum"
            defaultValue={round.dateOn ?? ""}
            disabled={pending}
            id={`${formId}-date`}
            name="dateOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-time`}>Time</label>
          <input
            className="tnum"
            defaultValue={round.time ?? ""}
            disabled={pending}
            id={`${formId}-time`}
            name="time"
            type="time"
          />
        </div>
        <div className="field interview-form-wide">
          <label htmlFor={`${formId}-meeting`}>Meeting link</label>
          <input
            defaultValue={round.meetingUrl ?? ""}
            disabled={pending}
            id={`${formId}-meeting`}
            name="meetingUrl"
            type="url"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-result`}>Result</label>
          <input
            defaultValue={round.result ?? ""}
            disabled={pending}
            id={`${formId}-result`}
            name="result"
            type="text"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-questions`}>Questions asked</label>
          <textarea
            defaultValue={round.questions ?? ""}
            disabled={pending}
            id={`${formId}-questions`}
            name="questions"
            rows={2}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-prep`}>Preparation notes</label>
          <textarea
            defaultValue={round.prepNotes ?? ""}
            disabled={pending}
            id={`${formId}-prep`}
            name="prepNotes"
            rows={2}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-performance`}>Performance notes</label>
          <textarea
            defaultValue={round.performance ?? ""}
            disabled={pending}
            id={`${formId}-performance`}
            name="performance"
            rows={2}
          />
        </div>
        <div className="field interview-form-wide">
          <label htmlFor={`${formId}-notes`}>Notes</label>
          <textarea
            defaultValue={round.notes ?? ""}
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
      <div className="interview-form-actions">
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save round"}
        </button>
        <button
          className="btn btn--ghost"
          disabled={pending}
          onClick={remove}
          type="button"
        >
          Delete round
        </button>
      </div>
    </form>
  );
}
