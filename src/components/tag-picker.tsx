"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { SUGGESTED_TAG_LABELS, type TagEntityType } from "@/domain/tag";

type AttachedTag = { tagId: string; label: string };

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "Could not update tags. Check the label and retry.";
}

export function TagPicker({
  attached,
  entityId,
  entityType,
  workspaceLabels,
}: {
  attached: AttachedTag[];
  entityId: string;
  entityType: TagEntityType;
  workspaceLabels: string[];
}) {
  const formId = useId();
  const listId = `${formId}-suggestions`;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const suggestions = Array.from(
    new Set([...SUGGESTED_TAG_LABELS, ...workspaceLabels]),
  );

  async function attach(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = String(new FormData(form).get("label") ?? "");
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, entityType, entityId }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body));
        return;
      }
      form.reset();
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function detach(tagId: string) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tags/detach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId, entityType, entityId }),
      });
      if (!response.ok) {
        const body: unknown = await response.json();
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
    <div className="tag-picker">
      {attached.length === 0 ? (
        <p className="section-empty">No tags yet. Suggestions are optional.</p>
      ) : (
        <ul aria-label="Tags" className="tag-picker-list">
          {attached.map((item) => (
            <li key={item.tagId}>
              <span className="chip tag-chip">
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <path d="M20.6 13.4 12.4 5.2A2 2 0 0 0 11 4.6H6a2 2 0 0 0-2 2v5a2 2 0 0 0 .6 1.4l8.2 8.2a2 2 0 0 0 2.8 0l5-5a2 2 0 0 0 0-2.8ZM8.5 9A1.5 1.5 0 1 1 10 7.5 1.5 1.5 0 0 1 8.5 9Z" />
                </svg>
                {item.label}
              </span>
              <button
                className="btn btn--ghost tag-chip-remove"
                disabled={pending}
                onClick={() => detach(item.tagId)}
                type="button"
              >
                Remove {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form aria-busy={pending} className="tag-picker-form" onSubmit={attach}>
        <div className="field">
          <label htmlFor={`${formId}-label`}>Add tag</label>
          <input
            autoComplete="off"
            disabled={pending}
            id={`${formId}-label`}
            list={listId}
            name="label"
            placeholder="Dream Company, Alumni Available…"
            required
          />
          <datalist id={listId}>
            {suggestions.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Saving…" : "Add tag"}
        </button>
      </form>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
    </div>
  );
}
