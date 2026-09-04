"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_COMPLETE_MESSAGE,
  REQUEST_FAILED_MESSAGE,
} from "@/lib/account";

function AlertIcon({ success = false }: { success?: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d={success ? "m5 12 4 4L19 6" : "M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function errorMessage(value: unknown): string {
  return value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : REQUEST_FAILED_MESSAGE;
}

export function PasswordRecoveryForm({ onSignIn }: { onSignIn?: () => void } = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const code = String(form.get("code") ?? "");
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirm") ?? "")) {
      setError("The two passwords do not match.");
      formRef.current?.reset();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/recovery/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, code, password }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(body));
        formRef.current?.reset();
        return;
      }
      formRef.current?.reset();
      setComplete(true);
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
      formRef.current?.reset();
    } finally {
      setPending(false);
    }
  }

  if (complete) {
    return (
      <>
        <p className="form-notice" role="status">
          <AlertIcon success />
          <span>{PASSWORD_RESET_COMPLETE_MESSAGE}</span>
        </p>
        <p className="auth-switch">
          Continue to{" "}
          {onSignIn ? (
            <button className="auth-inline-action" onClick={onSignIn} type="button">
              Sign in
            </button>
          ) : (
            <Link href="/?auth=sign-in">Sign in</Link>
          )}
        </p>
      </>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} ref={formRef}>
      {error ? (
        <p className="form-alert" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="recovery-username">Username</label>
        <input autoCapitalize="none" autoComplete="username" data-dialog-initial-focus id="recovery-username" name="username" required spellCheck={false} type="text" />
      </div>
      <div className="field">
        <label htmlFor="recovery-code">Authenticator code</label>
        <input autoComplete="one-time-code" id="recovery-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required type="text" />
      </div>
      <div className="field">
        <label htmlFor="recovery-password">New password</label>
        <input autoComplete="new-password" id="recovery-password" minLength={PASSWORD_MIN_LENGTH} name="password" required type="password" />
      </div>
      <div className="field">
        <label htmlFor="recovery-confirm">Confirm new password</label>
        <input autoComplete="new-password" id="recovery-confirm" minLength={PASSWORD_MIN_LENGTH} name="confirm" required type="password" />
      </div>
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}
