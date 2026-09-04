"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import {
  PASSWORD_MIN_LENGTH,
  REQUEST_FAILED_MESSAGE,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@/lib/account";

type Mode = "login" | "signup";

const MISMATCHED_PASSWORDS = "The two passwords do not match.";
const SHORT_PASSWORD = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      <path
        d="M12 8v5M12 16.5v.5M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function AccountForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === "signup";

  /** Cleared on every failure: a password is never written back into the DOM. */
  function clearPasswords() {
    if (passwordRef.current) {
      passwordRef.current.value = "";
    }
    if (confirmRef.current) {
      confirmRef.current.value = "";
    }
    passwordRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "");
    const password = String(data.get("password") ?? "");

    if (isSignup && password !== String(data.get("confirm") ?? "")) {
      setError(MISMATCHED_PASSWORDS);
      clearPasswords();
      return;
    }

    if (isSignup && password.length < PASSWORD_MIN_LENGTH) {
      setError(SHORT_PASSWORD);
      clearPasswords();
      return;
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body &&
          typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : REQUEST_FAILED_MESSAGE;

        setError(message);
        clearPasswords();
        return;
      }

      form.reset();
      const redirect =
        body &&
        typeof body === "object" &&
        typeof (body as { redirect?: unknown }).redirect === "string"
          ? (body as { redirect: string }).redirect
          : null;
      router.replace(redirect ?? (isSignup ? "/setup-totp" : "/"));
      router.refresh();
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
      clearPasswords();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit}>
      {error ? (
        <p className="form-alert" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          autoCapitalize="none"
          autoComplete="username"
          id="username"
          maxLength={isSignup ? USERNAME_MAX_LENGTH : 254}
          minLength={isSignup ? USERNAME_MIN_LENGTH : undefined}
          name="username"
          pattern={isSignup ? "[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]" : undefined}
          required
          spellCheck={false}
          type="text"
        />
        {isSignup ? (
          <p className="field-hint" id="username-hint">
            3–32 characters: letters, numbers, dot, underscore or hyphen.
          </p>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          autoComplete={isSignup ? "new-password" : "current-password"}
          id="password"
          minLength={isSignup ? PASSWORD_MIN_LENGTH : undefined}
          name="password"
          ref={passwordRef}
          required
          type="password"
        />
        {isSignup ? (
          <p className="field-hint" id="password-hint">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        ) : null}
      </div>

      {isSignup ? (
        <div className="field">
          <label htmlFor="confirm">Confirm password</label>
          <input
            autoComplete="new-password"
            id="confirm"
            name="confirm"
            ref={confirmRef}
            required
            type="password"
          />
        </div>
      ) : null}

      <button className="btn" disabled={pending} type="submit">
        {isSignup ? "Continue to authenticator" : "Sign in"}
      </button>
    </form>
  );
}
