"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";

import {
  EMAIL_TEMPLATE_SHELL_PLACEHOLDER,
  EMAIL_TEMPLATE_VARIABLES,
} from "@/domain/mail-template";

export type TemplateManagerRow = {
  id: string;
  title: string;
  subject: string;
  body: string;
  variablesJson: string[];
  defaultEmailAccountId: string | null;
  defaultDocumentVersionId: string | null;
  defaultFollowUpDays: number | null;
  tagsJson: string[];
};

type TemplateManagerProps = {
  accounts: { id: string; email: string }[];
  documents: { id: string; displayName: string }[];
  templates: TemplateManagerRow[];
};

function responseError(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function variablesIn(subject: string, body: string): string[] {
  const found = new Set<string>();
  const text = `${subject}\n${body}`;
  for (const variable of EMAIL_TEMPLATE_VARIABLES) {
    if (text.includes(`{{${variable}}}`)) found.add(variable);
  }
  return [...found];
}

export function TemplateManager({
  accounts,
  documents,
  templates: initialTemplates,
}: TemplateManagerProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedId, setSelectedId] = useState(initialTemplates[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? templates[0],
    [selectedId, templates],
  );

  async function createCustom() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const existing = new Set(templates.map((template) => template.title));
      let suffix = 1;
      while (existing.has(`Custom template ${suffix}`)) suffix += 1;
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Custom template ${suffix}`,
          subject: "",
          body: EMAIL_TEMPLATE_SHELL_PLACEHOLDER,
          variables: [],
          defaultEmailAccountId: null,
          defaultDocumentVersionId: null,
          defaultFollowUpDays: null,
          tags: [],
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not create the template."));
        return;
      }
      const created = body as TemplateManagerRow;
      setTemplates((current) => [...current, created]);
      setSelectedId(created.id);
      setMessage(`${created.title} created. Write it in your own words.`);
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
    const subject = String(form.get("subject") ?? "");
    const bodyText = String(form.get("body") ?? "");
    const followUp = String(form.get("defaultFollowUpDays") ?? "").trim();
    try {
      const response = await fetch(
        `/api/templates/${encodeURIComponent(selected.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: String(form.get("title") ?? ""),
            subject,
            body: bodyText,
            variables: variablesIn(subject, bodyText),
            defaultEmailAccountId:
              String(form.get("defaultEmailAccountId") ?? "") || null,
            defaultDocumentVersionId:
              String(form.get("defaultDocumentVersionId") ?? "") || null,
            defaultFollowUpDays: followUp ? Number(followUp) : null,
            tags: String(form.get("tags") ?? "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          }),
        },
      );
      const responseBody: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(responseBody, "Could not save the template."));
        return;
      }
      const updated = responseBody as TemplateManagerRow;
      setTemplates((current) =>
        current.map((template) =>
          template.id === updated.id ? updated : template,
        ),
      );
      setMessage(`${updated.title} saved.`);
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete ${selected.title}?`)) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/templates/${encodeURIComponent(selected.id)}`,
        { method: "DELETE" },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Could not delete the template."));
        return;
      }
      const remaining = templates.filter((template) => template.id !== selected.id);
      setTemplates(remaining);
      setSelectedId(remaining[0]?.id ?? "");
      setMessage(`${selected.title} deleted.`);
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="template-manager">
      <aside aria-label="Email templates" className="template-list-panel">
        <div className="template-list-panel__header">
          <div>
            <p className="eyebrow">Library</p>
            <h2>Templates</h2>
          </div>
          <button
            aria-label="Create custom template"
            className="btn btn--ghost template-add"
            disabled={pending}
            onClick={createCustom}
            type="button"
          >
            <Plus aria-hidden="true" />
            New
          </button>
        </div>
        <ul className="template-list">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                aria-current={template.id === selected?.id ? "true" : undefined}
                className="template-list__item"
                onClick={() => {
                  setSelectedId(template.id);
                  setError(null);
                  setMessage(null);
                }}
                type="button"
              >
                <strong>{template.title}</strong>
                <span>{template.subject || "Subject not written yet"}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {selected ? (
        <form className="template-editor" key={selected.id} onSubmit={save}>
          <div className="template-editor__header">
            <div>
              <p className="eyebrow">Owner-written</p>
              <h2>Edit template</h2>
            </div>
            <Link className="btn btn--ghost" href="/compose">
              Preview in composer
            </Link>
          </div>
          <p className="field-hint">
            Job Pilot substitutes literal variables. It never drafts or rewrites this message.
          </p>
          <div className="field">
            <label htmlFor="template-title">Title</label>
            <input defaultValue={selected.title} id="template-title" name="title" required />
          </div>
          <div className="field">
            <label htmlFor="template-subject">Subject</label>
            <input defaultValue={selected.subject} id="template-subject" name="subject" />
          </div>
          <div className="field">
            <label htmlFor="template-body">Body</label>
            <textarea defaultValue={selected.body} id="template-body" name="body" rows={14} />
          </div>
          <div className="template-variable-list" aria-label="Available variables">
            {EMAIL_TEMPLATE_VARIABLES.map((variable) => (
              <code key={variable}>{`{{${variable}}}`}</code>
            ))}
          </div>
          <div className="template-editor__grid">
            <div className="field">
              <label htmlFor="template-account">Default sender account</label>
              <select defaultValue={selected.defaultEmailAccountId ?? ""} id="template-account" name="defaultEmailAccountId">
                <option value="">Workspace default</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.email}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="template-document">Default attachment</label>
              <select defaultValue={selected.defaultDocumentVersionId ?? ""} id="template-document" name="defaultDocumentVersionId">
                <option value="">No attachment</option>
                {documents.map((document) => <option key={document.id} value={document.id}>{document.displayName}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="template-follow-up">Default follow-up delay (days)</label>
              <input defaultValue={selected.defaultFollowUpDays ?? ""} id="template-follow-up" max={365} min={0} name="defaultFollowUpDays" step={1} type="number" />
            </div>
            <div className="field">
              <label htmlFor="template-tags">Tags, comma-separated</label>
              <input defaultValue={selected.tagsJson.join(", ")} id="template-tags" name="tags" />
            </div>
          </div>
          {error ? <p className="form-alert" role="alert"><AlertTriangle aria-hidden="true" />{error}</p> : null}
          {message ? <p className="form-notice" role="status"><CheckCircle2 aria-hidden="true" />{message}</p> : null}
          <div className="template-editor__actions">
            <button className="btn" disabled={pending} type="submit">{pending ? "Saving…" : "Save template"}</button>
            <button className="btn btn--danger" disabled={pending} onClick={remove} type="button"><Trash2 aria-hidden="true" />Delete template</button>
          </div>
        </form>
      ) : (
        <section className="data-state data-state--empty">
          <h2>No templates</h2>
          <p>Write one; the app will not draft it for you.</p>
        </section>
      )}
    </div>
  );
}
