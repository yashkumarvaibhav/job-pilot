"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  DIGEST_ACCOUNT_HELP,
  DIGEST_DISABLED_HELP,
  DIGEST_EMAIL_LABEL,
  DIGEST_HELP,
  DIGEST_HOUR_HELP,
} from "@/domain/digest";

export type DigestAccountOption = {
  id: string;
  email: string;
  status: "connected" | "disconnected" | "error";
};

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function MorningDigestPanel({
  accounts,
  digestAccountId,
  digestEmailEnabled,
  digestHour,
  selectedAccountLiveEmail,
}: {
  accounts: DigestAccountOption[];
  digestAccountId: string | null;
  digestEmailEnabled: boolean;
  digestHour: number | null;
  selectedAccountLiveEmail: string | null;
}) {
  const formId = useId();
  const router = useRouter();
  const connected = accounts.filter((account) => account.status === "connected");
  const selected =
    accounts.find((account) => account.id === digestAccountId) ?? null;
  const options =
    selected && !connected.some((account) => account.id === selected.id)
      ? [...connected, selected]
      : connected;
  const [accountId, setAccountId] = useState(digestAccountId ?? "");
  const [enabled, setEnabled] = useState(digestEmailEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const liveEmail =
    options.find((account) => account.id === accountId)?.email ??
    selectedAccountLiveEmail ??
    "";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);
    const hourValue = String(form.get("digestHour") ?? "");
    try {
      const response = await fetch("/api/settings/digest", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          digestHour: hourValue.length === 0 ? null : Number(hourValue),
          digestAccountId: accountId.length === 0 ? null : accountId,
          digestEmailEnabled: enabled,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body, "Could not save the morning digest."));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="settings-section" onSubmit={submit}>
      <h2 id={`${formId}-digest`}>Morning digest</h2>
      <p className="settings-help">{DIGEST_HELP}</p>
      {options.length === 0 ? (
        <p className="settings-hint">{DIGEST_DISABLED_HELP}</p>
      ) : null}
      <div className="settings-grid">
        <div className="field">
          <label htmlFor={`${formId}-hour`}>Digest hour</label>
          <select
            className="tnum"
            defaultValue={digestHour == null ? "" : String(digestHour)}
            disabled={pending}
            id={`${formId}-hour`}
            name="digestHour"
          >
            <option value="">Not set</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={String(hour)}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <p className="settings-hint">{DIGEST_HOUR_HELP}</p>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-account`}>Gmail account</label>
          <select
            disabled={pending || options.length === 0}
            id={`${formId}-account`}
            name="digestAccountId"
            onChange={(event) => {
              const next = event.currentTarget.value;
              setAccountId(next);
              if (next !== (digestAccountId ?? "")) {
                setEnabled(false);
              }
            }}
            value={accountId}
          >
            <option value="">Select a connected account</option>
            {options.map((account) => (
              <option key={account.id} value={account.id}>
                {account.email}
                {account.status !== "connected" ? " (disconnected)" : ""}
              </option>
            ))}
          </select>
          <p className="settings-hint">{DIGEST_ACCOUNT_HELP}</p>
        </div>
        <div className="field">
          <label htmlFor={`${formId}-address`}>Digest address</label>
          <input
            id={`${formId}-address`}
            readOnly
            type="email"
            value={liveEmail}
          />
        </div>
      </div>
      <label className="checkbox-field">
        <input
          checked={enabled}
          disabled={pending || accountId.length === 0}
          name="digestEmailEnabled"
          onChange={(event) => setEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        {DIGEST_EMAIL_LABEL}
      </label>
      {error ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      ) : null}
      <div className="settings-actions">
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save digest"}
        </button>
        <Link className="btn btn--ghost" href="/settings/digest/preview">
          Preview
        </Link>
        <p aria-live="polite" className="settings-saved" role="status">
          {saved ? "Digest settings saved." : ""}
        </p>
      </div>
    </form>
  );
}
