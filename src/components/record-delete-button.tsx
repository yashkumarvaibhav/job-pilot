"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function RecordDeleteButton({
  endpoint,
  label,
  name,
  redirectTo,
}: {
  endpoint: string;
  label: string;
  name: string;
  redirectTo: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`${label} “${name}”? This cannot be undone.`)) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setMessage(responseError(body, `Could not ${label.toLowerCase()}.`));
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="record-delete-action">
      <button
        className="btn btn--danger"
        disabled={pending}
        onClick={() => void remove()}
        type="button"
      >
        <Trash2 aria-hidden="true" />
        {pending ? "Deleting…" : label}
      </button>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
    </div>
  );
}
