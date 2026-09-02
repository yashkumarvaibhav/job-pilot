"use client";

import { type FormEvent, useRef, useState } from "react";

import { PASSWORD_MIN_LENGTH, REQUEST_FAILED_MESSAGE } from "@/lib/account";

type Mode = "request-recovery" | "request-verification" | "verify" | "reset";

const MISMATCHED_PASSWORDS = "The two passwords do not match.";
const SHORT_PASSWORD = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;

const CONFIG: Record<Mode, { endpoint: string; button: string }> = {
  "request-recovery": {
    endpoint: "/api/auth/recovery/request",
    button: "Send reset link",
  },
  "request-verification": {
    endpoint: "/api/auth/verification/request",
    button: "Send verification link",
  },
  verify: { endpoint: "/api/auth/verify", button: "Verify email" },
  reset: { endpoint: "/api/auth/recovery/reset", button: "Reset password" },
};

function StateIcon({ success }: { success: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      {success ? (
        <path
          d="m5 12 4 4L19 6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      ) : (
        <path
          d="M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

export function AccountLifecycleForm({
  mode,
  token,
}: {
  mode: Mode;
  token?: string;
}) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const asksForEmail =
    mode === "request-recovery" || mode === "request-verification";
  const asksForPassword = mode === "reset";

  function clearPasswords() {
    if (passwordRef.current) passwordRef.current.value = "";
    if (confirmRef.current) confirmRef.current.value = "";
    passwordRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");

    if (asksForPassword && password !== String(data.get("confirm") ?? "")) {
      setError(MISMATCHED_PASSWORDS);
      clearPasswords();
      return;
    }
    if (asksForPassword && password.length < PASSWORD_MIN_LENGTH) {
      setError(SHORT_PASSWORD);
      clearPasswords();
      return;
    }

    const payload = asksForEmail
      ? { email: String(data.get("email") ?? "") }
      : asksForPassword
        ? { token: token ?? "", password }
        : { token: token ?? "" };
    setPending(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(CONFIG[mode].endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      const message =
        body &&
        typeof body === "object" &&
        typeof (body as { error?: unknown; message?: unknown })[
          response.ok ? "message" : "error"
        ] === "string"
          ? String(
              (body as { error?: unknown; message?: unknown })[
                response.ok ? "message" : "error"
              ],
            )
          : response.ok
            ? mode === "verify"
              ? "Email verified. You can sign in."
              : "Done."
            : REQUEST_FAILED_MESSAGE;

      if (!response.ok) {
        setError(message);
        if (asksForPassword) clearPasswords();
        return;
      }

      form.reset();
      setNotice(message);
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
      if (asksForPassword) clearPasswords();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit}>
      {error ? (
        <p className="form-alert" role="alert">
          <StateIcon success={false} />
          <span>{error}</span>
        </p>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          <StateIcon success />
          <span>{notice}</span>
        </p>
      ) : null}

      {asksForEmail ? (
        <div className="field">
          <label htmlFor={`${mode}-email`}>Email</label>
          <input
            autoComplete="email"
            id={`${mode}-email`}
            name="email"
            required
            type="email"
          />
        </div>
      ) : null}

      {asksForPassword ? (
        <>
          <div className="field">
            <label htmlFor="reset-password">New password</label>
            <input
              autoComplete="new-password"
              id="reset-password"
              minLength={PASSWORD_MIN_LENGTH}
              name="password"
              ref={passwordRef}
              required
              type="password"
            />
            <p className="field-hint">At least {PASSWORD_MIN_LENGTH} characters.</p>
          </div>
          <div className="field">
            <label htmlFor="reset-confirm">Confirm new password</label>
            <input
              autoComplete="new-password"
              id="reset-confirm"
              name="confirm"
              ref={confirmRef}
              required
              type="password"
            />
          </div>
        </>
      ) : null}

      <button className="btn" disabled={pending} type="submit">
        {CONFIG[mode].button}
      </button>
    </form>
  );
}
