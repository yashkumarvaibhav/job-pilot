"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  INTERACTION_CHANNELS,
  INTERACTION_DIRECTIONS,
  type InteractionDirection,
} from "@/domain/interaction";

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Could not save the interaction. Check the fields and retry.";
}

export function InteractionLogForm({ contactId }: { contactId: string }) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [direction, setDirection] = useState<InteractionDirection>("outbound");
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setSaved(false);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const occurredAt = String(form.get("occurredAt") ?? "").trim();
    const payload = {
      channel: String(form.get("channel") ?? ""),
      direction: String(form.get("direction") ?? "outbound"),
      body: String(form.get("body") ?? ""),
      requiresReply:
        String(form.get("direction") ?? "") === "inbound" &&
        form.get("requiresReply") === "on",
      ...(occurredAt ? { occurredAt: new Date(occurredAt).toISOString() } : {}),
    };

    try {
      const response = await fetch(`/api/contacts/${contactId}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body));
        return;
      }
      formElement.reset();
      setDirection("outbound");
      setSaved(true);
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="interaction-form" onSubmit={submit}>
      <div className="contact-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-channel`}>Channel</label>
          <select
            defaultValue="whatsapp"
            disabled={pending}
            id={`${formId}-channel`}
            name="channel"
            required
          >
            {INTERACTION_CHANNELS.map((channel) => (
              <option key={channel.value} value={channel.value}>
                {channel.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-direction`}>Direction</label>
          <select
            disabled={pending}
            id={`${formId}-direction`}
            name="direction"
            onChange={(event) =>
              setDirection(event.target.value as InteractionDirection)
            }
            required
            value={direction}
          >
            {INTERACTION_DIRECTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-occurred`}>When</label>
          <input
            className="tnum"
            disabled={pending}
            id={`${formId}-occurred`}
            name="occurredAt"
            type="datetime-local"
          />
        </div>
        <div className="field contact-form-wide">
          <label htmlFor={`${formId}-body`}>Message</label>
          <textarea
            disabled={pending}
            id={`${formId}-body`}
            name="body"
            rows={4}
          />
        </div>
      </div>

      {direction === "inbound" ? (
        <label className="checkbox-field">
          <input disabled={pending} name="requiresReply" type="checkbox" />
          Needs my reply
        </label>
      ) : (
        <p className="field-hint">
          Logging this does not send mail. It is a record of a message you
          already sent.
        </p>
      )}

      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
      <p aria-live="polite" className="save-status">
        {saved ? "Interaction logged." : ""}
      </p>
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Saving…" : "Log interaction"}
      </button>
    </form>
  );
}

export function MarkRepliedButton({
  contactId,
  interactionId,
}: {
  contactId: string;
  interactionId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function markReplied() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/contacts/${contactId}/interactions/${interactionId}/mark-replied`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setMessage(responseError(body));
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
    <span className="interaction-reply-action">
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => void markReplied()}
        type="button"
      >
        {pending ? "Saving…" : "Mark replied"}
      </button>
      {message ? (
        <span className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </span>
      ) : null}
    </span>
  );
}
