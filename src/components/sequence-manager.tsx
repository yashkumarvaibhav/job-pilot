"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus } from "lucide-react";

import { DEFAULT_SEQUENCE_OFFSET_DAYS } from "@/domain/sequence";

export type SequenceManagerStep = {
  id?: string;
  offsetDays: number;
  templateId: string;
};

export type SequenceManagerRow = {
  id: string;
  name: string;
  enrollmentCount: number;
  steps: SequenceManagerStep[];
};

type SequenceManagerProps = {
  templates: { id: string; title: string }[];
  sequences: SequenceManagerRow[];
};

function responseError(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function SequenceManager({
  templates,
  sequences: initialSequences,
}: SequenceManagerProps) {
  const [sequences, setSequences] = useState(initialSequences);
  const [selectedId, setSelectedId] = useState(initialSequences[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(
    () => sequences.find((sequence) => sequence.id === selectedId) ?? sequences[0],
    [selectedId, sequences],
  );
  const defaultTemplateId = templates[0]?.id ?? "";

  async function createSequence() {
    if (!defaultTemplateId) {
      setError("Write a template before creating a sequence.");
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const existing = new Set(sequences.map((sequence) => sequence.name));
      let suffix = 1;
      while (existing.has(`Sequence ${suffix}`)) suffix += 1;
      const response = await fetch("/api/sequences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `Sequence ${suffix}`,
          steps: DEFAULT_SEQUENCE_OFFSET_DAYS.map((offsetDays) => ({
            offsetDays,
            templateId: defaultTemplateId,
          })),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not create the sequence."));
        return;
      }
      const created = body as SequenceManagerRow;
      setSequences((current) => [...current, created]);
      setSelectedId(created.id);
      setMessage(`${created.name} created. Day 0 still needs your approval to send.`);
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const steps = DEFAULT_SEQUENCE_OFFSET_DAYS.flatMap((offsetDays, index) => {
      const templateId = String(form.get(`template-${index}`) ?? "");
      return templateId ? [{ offsetDays, templateId }] : [];
    });
    try {
      const response = await fetch(`/api/sequences/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          steps,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not save the sequence."));
        return;
      }
      const updated = body as SequenceManagerRow;
      setSequences((current) =>
        current.map((sequence) => (sequence.id === updated.id ? updated : sequence)),
      );
      setMessage(`${updated.name} saved.`);
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="template-manager sequence-manager">
      <aside aria-label="Email sequences" className="template-list-panel">
        <div className="template-list-panel__header">
          <div>
            <p className="eyebrow">Offsets</p>
            <h2>Sequences</h2>
          </div>
          <button
            aria-label="Create sequence"
            className="btn btn--ghost template-add"
            disabled={pending}
            onClick={() => void createSequence()}
            type="button"
          >
            <Plus aria-hidden="true" />
            New
          </button>
        </div>
        {sequences.length === 0 ? (
          <p className="section-empty">No sequences yet. Create one with day 0 / 4 / 9 / 16.</p>
        ) : (
          <ul className="template-list">
            {sequences.map((sequence) => (
              <li key={sequence.id}>
                <button
                  aria-current={sequence.id === selected?.id ? "true" : undefined}
                  className="template-list__item"
                  onClick={() => {
                    setSelectedId(sequence.id);
                    setError(null);
                    setMessage(null);
                  }}
                  type="button"
                >
                  <strong>{sequence.name}</strong>
                  <span className="tnum">{sequence.steps.length} steps</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {selected ? (
        <form className="template-editor" key={selected.id} onSubmit={(event) => void save(event)}>
          <div className="template-editor__header">
            <div>
              <p className="eyebrow">Exact drafts</p>
              <h2>Edit sequence</h2>
            </div>
          </div>
          <p>Each due email requires your approval. Enrollment never sends.</p>
          {error ? (
            <p className="form-alert" role="alert">
              <AlertTriangle aria-hidden="true" />
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="form-notice" role="status">
              <CheckCircle2 aria-hidden="true" />
              {message}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="sequence-name">Name</label>
            <input
              defaultValue={selected.name}
              id="sequence-name"
              name="name"
              required
            />
          </div>
          <ol className="sequence-step-list">
            {DEFAULT_SEQUENCE_OFFSET_DAYS.map((offsetDays, index) => {
              const step = selected.steps.find((item) => item.offsetDays === offsetDays);
              return (
                <li key={offsetDays}>
                  <div className="field">
                    <label htmlFor={`sequence-template-${index}`}>
                      Day {offsetDays} template
                    </label>
                    <select
                      defaultValue={step?.templateId ?? defaultTemplateId}
                      id={`sequence-template-${index}`}
                      name={`template-${index}`}
                      required={index === 0}
                    >
                      {index === 0 ? null : <option value="">Skip this day</option>}
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="template-editor__actions">
            <button className="btn" disabled={pending} type="submit">
              Save sequence
            </button>
          </div>
        </form>
      ) : (
        <div className="template-editor data-state">
          <h2>No sequence selected</h2>
          <p>Create a sequence to schedule day 0 / 4 / 9 / 16 drafts.</p>
        </div>
      )}
    </div>
  );
}
