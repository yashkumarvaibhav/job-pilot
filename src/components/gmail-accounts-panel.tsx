"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

import {
  GMAIL_NOT_CONNECTED_HELP,
  GMAIL_NOT_CONNECTED_TITLE,
} from "@/domain/settings";

export type GmailAccountCard = {
  id: string;
  email: string;
  senderName: string;
  signature: string | null;
  replyTo: string | null;
  dailyLimit: number;
  sendingWindowStart: number;
  sendingWindowEnd: number;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
  isDefault: boolean;
};

function clockValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
    minutes % 60,
  ).padStart(2, "0")}`;
}

function clockMinutes(value: FormDataEntryValue | null): number {
  const [hours, minutes] = String(value ?? "").split(":").map(Number);
  return hours * 60 + minutes;
}

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function StatusIcon({ status }: { status: GmailAccountCard["status"] }) {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
      {status === "connected" ? (
        <path
          d="m7 12 3 3 7-7M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : status === "error" ? (
        <path
          d="M12 8v5m0 3h.01M10.3 4.9 3 17.5A1 1 0 0 0 3.9 19h16.2a1 1 0 0 0 .9-1.5L13.7 4.9a1 1 0 0 0-1.7 0Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : (
        <path
          d="m8 8 8 8m0-8-8 8M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

function PilotChip() {
  return (
    <p className="chip settings-chip settings-chip--pilot">
      <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
        <path
          d="M9 3h6M10 3v5l-4.5 8.2A3.2 3.2 0 0 0 8.3 21h7.4a3.2 3.2 0 0 0 2.8-4.8L14 8V3M8 15h8"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      Limited pilot
    </p>
  );
}

export function GmailAccountsPanel({
  accounts,
  configured,
  missing,
}: {
  accounts: GmailAccountCard[];
  configured: boolean;
  missing: string[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function request(
    account: GmailAccountCard,
    path: string,
    options: RequestInit,
    success: string,
  ): Promise<Record<string, unknown> | null> {
    setPendingId(account.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(path, options);
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body, `Could not update ${account.email}.`));
        return null;
      }
      setMessage(success);
      router.refresh();
      return typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
      return null;
    } finally {
      setPendingId(null);
    }
  }

  async function save(
    event: React.FormEvent<HTMLFormElement>,
    account: GmailAccountCard,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request(
      account,
      `/api/gmail/${encodeURIComponent(account.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          senderName: String(form.get("senderName") ?? ""),
          signature: String(form.get("signature") ?? ""),
          replyTo: String(form.get("replyTo") ?? ""),
          dailyLimit: Number(form.get("dailyLimit")),
          sendingWindowStart: clockMinutes(form.get("sendingWindowStart")),
          sendingWindowEnd: clockMinutes(form.get("sendingWindowEnd")),
        }),
      },
      `${account.email} settings saved.`,
    );
  }

  async function makeDefault(account: GmailAccountCard) {
    await request(
      account,
      `/api/gmail/${encodeURIComponent(account.id)}/default`,
      { method: "POST" },
      `${account.email} is now the default sender.`,
    );
  }

  async function disconnect(account: GmailAccountCard) {
    if (
      !window.confirm(
        `Disconnect ${account.email}? Its local Gmail credential will be removed.`,
      )
    ) {
      return;
    }
    const body = await request(
      account,
      `/api/gmail/${encodeURIComponent(account.id)}/disconnect`,
      { method: "POST" },
      `${account.email} disconnected.`,
    );
    if (body && body.googleRevoked === false) {
      setMessage(
        `${account.email} disconnected locally. Remove Job Pilot in Google Account permissions if it still appears there.`,
      );
    }
  }

  const addControl = configured ? (
    <Link className="btn" href="/api/gmail/connect">
      Add Gmail account
    </Link>
  ) : (
    <button className="btn btn--ghost" disabled type="button">
      Add Gmail account
    </button>
  );

  if (accounts.length === 0) {
    return (
      <div className="data-state data-state--empty" role="status">
        <PilotChip />
        <h3>{GMAIL_NOT_CONNECTED_TITLE}</h3>
        <p>{GMAIL_NOT_CONNECTED_HELP}</p>
        {!configured ? (
          <p className="settings-help">
            OAuth configuration is missing: {missing.join(", ")}.
          </p>
        ) : null}
        {addControl}
      </div>
    );
  }

  return (
    <div className="gmail-accounts">
      <div className="gmail-accounts__toolbar">
        <div>
          <PilotChip />
          <p className="settings-help">
            Each identity keeps its own sender details, limits and sync state.
          </p>
          {!configured ? (
            <p className="settings-help">
              Adding or reconnecting is unavailable: {missing.join(", ")}.
            </p>
          ) : null}
        </div>
        {addControl}
      </div>

      {error ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="settings-saved" role="status">
        {message ?? ""}
      </p>

      <div className="gmail-account-grid">
        {accounts.map((account) => {
          const pending = pendingId === account.id;
          const statusLabel =
            account.status === "connected"
              ? "Connected"
              : account.status === "error"
                ? "Needs attention"
                : "Disconnected";
          return (
            <article className="gmail-account-card" key={account.id}>
              <header className="gmail-account-card__header">
                <div>
                  <p className="gmail-account-card__eyebrow">Gmail identity</p>
                  <h3>{account.email}</h3>
                </div>
                <div className="gmail-account-card__chips">
                  <p
                    className={`chip settings-chip gmail-status gmail-status--${account.status}`}
                  >
                    <StatusIcon status={account.status} />
                    {statusLabel}
                  </p>
                  {account.isDefault ? (
                    <p className="chip settings-chip gmail-status gmail-status--default">
                      <svg
                        aria-hidden="true"
                        height="16"
                        viewBox="0 0 24 24"
                        width="16"
                      >
                        <path
                          d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"
                          fill="none"
                          stroke="currentColor"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                      </svg>
                      Default sender
                    </p>
                  ) : null}
                </div>
              </header>

              <p className="settings-hint">
                Last Inbox sync: {account.lastSyncAt ?? "Not synced yet"}
              </p>

              <form
                aria-busy={pending}
                className="gmail-account-form"
                onSubmit={(event) => save(event, account)}
              >
                <div className="settings-grid gmail-account-form__grid">
                  <div className="field">
                    <label htmlFor={`${account.id}-sender-name`}>Sender name</label>
                    <input
                      defaultValue={account.senderName}
                      disabled={pending}
                      id={`${account.id}-sender-name`}
                      maxLength={120}
                      name="senderName"
                      type="text"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${account.id}-reply-to`}>Reply-to</label>
                    <input
                      autoComplete="email"
                      defaultValue={account.replyTo ?? ""}
                      disabled={pending}
                      id={`${account.id}-reply-to`}
                      name="replyTo"
                      type="email"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${account.id}-daily-limit`}>Daily send limit</label>
                    <input
                      className="tnum"
                      defaultValue={account.dailyLimit}
                      disabled={pending}
                      id={`${account.id}-daily-limit`}
                      max={500}
                      min={1}
                      name="dailyLimit"
                      required
                      step={1}
                      type="number"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${account.id}-window-start`}>Send from</label>
                    <input
                      className="tnum"
                      defaultValue={clockValue(account.sendingWindowStart)}
                      disabled={pending}
                      id={`${account.id}-window-start`}
                      name="sendingWindowStart"
                      required
                      type="time"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${account.id}-window-end`}>Send until</label>
                    <input
                      className="tnum"
                      defaultValue={clockValue(account.sendingWindowEnd)}
                      disabled={pending}
                      id={`${account.id}-window-end`}
                      name="sendingWindowEnd"
                      required
                      type="time"
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`${account.id}-signature`}>Signature</label>
                  <textarea
                    defaultValue={account.signature ?? ""}
                    disabled={pending}
                    id={`${account.id}-signature`}
                    maxLength={10000}
                    name="signature"
                    rows={4}
                  />
                </div>
                <div className="gmail-account-card__actions">
                  <button className="btn" disabled={pending} type="submit">
                    {pending ? "Working…" : "Save account settings"}
                  </button>
                  {!account.isDefault ? (
                    <button
                      className="btn btn--ghost"
                      disabled={pending || account.status !== "connected"}
                      onClick={() => makeDefault(account)}
                      type="button"
                    >
                      Set as default
                    </button>
                  ) : null}
                  {configured ? (
                    <Link
                      className="btn btn--ghost"
                      href={`/api/gmail/connect?accountId=${encodeURIComponent(account.id)}`}
                    >
                      Reconnect
                    </Link>
                  ) : null}
                  <button
                    className="btn btn--danger"
                    disabled={pending}
                    onClick={() => disconnect(account)}
                    type="button"
                  >
                    Disconnect
                  </button>
                </div>
              </form>
            </article>
          );
        })}
      </div>
    </div>
  );
}
