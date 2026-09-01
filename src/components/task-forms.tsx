"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  TASK_LINK_TYPES,
  TASK_PRIORITIES,
  type TaskLinkType,
} from "@/domain/task";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export type TaskLinkOption = { id: string; label: string };

export type TaskLinkOptions = {
  company: TaskLinkOption[];
  contact: TaskLinkOption[];
  opportunity: TaskLinkOption[];
  application: TaskLinkOption[];
  referral: TaskLinkOption[];
};

export function TaskCreateForm({ links }: { links: TaskLinkOptions }) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<TaskLinkType | "">("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      dueOn: String(form.get("dueOn") ?? ""),
      priority: String(form.get("priority") ?? "medium"),
      entityType: entityType || null,
      entityId: entityType ? String(form.get("entityId") ?? "") || null : null,
    };
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not save the task."));
        return;
      }
      event.currentTarget.reset();
      setEntityType("");
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  const options = entityType ? links[entityType] : [];

  return (
    <form aria-busy={pending} className="task-form" onSubmit={submit}>
      <div className="task-form-grid">
        <div className="field">
          <label htmlFor={`${formId}-title`}>Title</label>
          <input
            disabled={pending}
            id={`${formId}-title`}
            name="title"
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-due`}>Due date</label>
          <input
            className="tnum"
            disabled={pending}
            id={`${formId}-due`}
            name="dueOn"
            type="date"
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-priority`}>Priority</label>
          <select
            defaultValue="medium"
            disabled={pending}
            id={`${formId}-priority`}
            name="priority"
          >
            {TASK_PRIORITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-entity-type`}>Linked entity</label>
          <select
            disabled={pending}
            id={`${formId}-entity-type`}
            onChange={(event) =>
              setEntityType((event.target.value || "") as TaskLinkType | "")
            }
            value={entityType}
          >
            <option value="">None</option>
            {TASK_LINK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.slice(0, 1).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {entityType ? (
          <div className="field">
            <label htmlFor={`${formId}-entity-id`}>
              {entityType.slice(0, 1).toUpperCase() + entityType.slice(1)}
            </label>
            <select
              disabled={pending || options.length === 0}
              id={`${formId}-entity-id`}
              name="entityId"
            >
              <option value="">Choose one</option>
              {options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field task-form-wide">
          <label htmlFor={`${formId}-description`}>Description</label>
          <textarea
            disabled={pending}
            id={`${formId}-description`}
            name="description"
            rows={3}
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
        {pending ? "Saving…" : "Add task"}
      </button>
    </form>
  );
}

export function TaskCompleteButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function complete() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/complete`, {
        method: "POST",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not complete the task."));
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
    <span className="task-complete">
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => void complete()}
        type="button"
      >
        {pending ? "Completing…" : "Complete"}
      </button>
      {message ? (
        <span className="form-alert" role="alert">
          {message}
        </span>
      ) : null}
    </span>
  );
}

export function ConvertDueItemButton({
  sourceKey,
  title,
}: {
  sourceKey: string;
  title: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function convert() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tasks/from-derived", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKey }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not create a task from this row."));
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
    <span className="task-complete">
      <button
        aria-label={`Create task: ${title}`}
        className="btn"
        disabled={pending}
        onClick={() => void convert()}
        type="button"
      >
        {pending ? "Creating…" : "Create task"}
      </button>
      {message ? (
        <span className="form-alert" role="alert">
          {message}
        </span>
      ) : null}
    </span>
  );
}
