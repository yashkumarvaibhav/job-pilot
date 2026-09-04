"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import {
  PASSWORD_MIN_LENGTH,
  REQUEST_FAILED_MESSAGE,
  TOTP_SKIPPED_WARNING,
} from "@/lib/account";
import type { TotpSetup } from "@/server/auth/totp";
import { AuthenticatorQrCode } from "./authenticator-qr-code";

function StateIcon({ success = false }: { success?: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
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

function responseMessage(value: unknown, fallback: string): string {
  return value &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function TotpSkippedWarning() {
  return (
    <p className="security-warning" role="status">
      <StateIcon />
      <span>{TOTP_SKIPPED_WARNING}</span>
    </p>
  );
}

export function TotpSetupPanel({
  available,
  initialSetup,
  onboarding = false,
}: {
  available: boolean;
  initialSetup: TotpSetup | null;
  onboarding?: boolean;
}) {
  const router = useRouter();
  const codeRef = useRef<HTMLInputElement>(null);
  const [setup, setSetup] = useState(initialSetup);
  const [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function begin() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/totp/setup", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseMessage(body, REQUEST_FAILED_MESSAGE));
        return;
      }
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { secret?: unknown }).secret !== "string" ||
        typeof (body as { uri?: unknown }).uri !== "string"
      ) {
        setError(REQUEST_FAILED_MESSAGE);
        return;
      }
      setSetup(body as TotpSetup);
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  async function copySecret() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Could not copy the setup key. Select and copy it manually.");
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/totp/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseMessage(body, REQUEST_FAILED_MESSAGE));
        if (codeRef.current) codeRef.current.value = "";
        codeRef.current?.focus();
        return;
      }
      if (onboarding) {
        const redirect =
          body &&
          typeof body === "object" &&
          typeof (body as { redirect?: unknown }).redirect === "string"
            ? (body as { redirect: string }).redirect
            : "/";
        router.replace(redirect);
        router.refresh();
        return;
      }
      setEnabled(true);
      setSetup(null);
      router.refresh();
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  if (enabled) {
    return (
      <p className="form-notice" role="status">
        <StateIcon success />
        <span>Authenticator enabled.</span>
      </p>
    );
  }

  if (!available) {
    return (
      <div className="totp-setup">
        <p className="form-alert" role="alert">
          <StateIcon />
          <span>Account security is temporarily unavailable. Try again later.</span>
        </p>
        <button className="btn btn--ghost" disabled type="button">
          Set up authenticator
        </button>
      </div>
    );
  }

  return (
    <div className="totp-setup">
      {error ? (
        <p className="form-alert" role="alert">
          <StateIcon />
          <span>{error}</span>
        </p>
      ) : null}

      {setup ? (
        <>
          <div className="totp-scan-panel">
            <div className="totp-scan-copy">
              <span className="eyebrow">Authenticator setup</span>
              <h3>Scan with your authenticator app</h3>
              <p>
                Open your authenticator app, add a new account, then scan this QR code.
              </p>
            </div>
            <AuthenticatorQrCode uri={setup.uri} />
          </div>
          <details className="totp-manual">
            <summary>Can’t scan it?</summary>
            <div className="totp-key-block">
              <p className="settings-help">
                Enter this manual setup key in your authenticator app instead.
              </p>
              <span className="eyebrow">Manual setup key</span>
              <code className="totp-secret">{setup.secret}</code>
              <div className="security-actions">
                <button className="btn btn--ghost" onClick={copySecret} type="button">
                  Copy setup key
                </button>
                <a className="btn btn--ghost" href={setup.uri}>
                  Open authenticator app
                </a>
              </div>
              <p aria-live="polite" className="settings-saved" role="status">
                {copied ? "Setup key copied." : ""}
              </p>
            </div>
          </details>
          <form className="security-form" onSubmit={confirm}>
            <div>
              <h3>Confirm the connection</h3>
              <p className="settings-help">
                Enter the current six-digit code shown in your authenticator app.
              </p>
            </div>
            <div className="field">
              <label htmlFor={onboarding ? "onboarding-totp-code" : "settings-totp-code"}>
                Six-digit code
              </label>
              <input
                autoComplete="one-time-code"
                id={onboarding ? "onboarding-totp-code" : "settings-totp-code"}
                inputMode="numeric"
                maxLength={6}
                name="code"
                pattern="[0-9]{6}"
                ref={codeRef}
                required
                type="text"
              />
            </div>
            <button className="btn" disabled={pending} type="submit">
              {pending ? "Checking…" : "Enable authenticator"}
            </button>
          </form>
        </>
      ) : (
        <button className="btn btn--ghost" disabled={pending} onClick={begin} type="button">
          {pending ? "Preparing…" : "Set up authenticator"}
        </button>
      )}

    </div>
  );
}

function PasswordChangeForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const code = String(form.get("code") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError("The two new passwords do not match.");
      formRef.current?.reset();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, code, newPassword }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseMessage(body, REQUEST_FAILED_MESSAGE));
        formRef.current?.reset();
        return;
      }
      formRef.current?.reset();
      router.replace("/login");
      router.refresh();
    } catch {
      setError(REQUEST_FAILED_MESSAGE);
      formRef.current?.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="security-form" onSubmit={submit} ref={formRef}>
      <h3>Change password</h3>
      <p className="settings-help">
        A successful change signs every device out, including this one.
      </p>
      {error ? (
        <p className="form-alert" role="alert">
          <StateIcon />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="settings-grid">
        <div className="field">
          <label htmlFor="current-password">Current password</label>
          <input autoComplete="current-password" id="current-password" name="currentPassword" required type="password" />
        </div>
        <div className="field">
          <label htmlFor="change-totp-code">Authenticator code</label>
          <input autoComplete="one-time-code" id="change-totp-code" inputMode="numeric" maxLength={6} name="code" pattern="[0-9]{6}" required type="text" />
        </div>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input autoComplete="new-password" id="new-password" minLength={PASSWORD_MIN_LENGTH} name="newPassword" required type="password" />
        </div>
        <div className="field">
          <label htmlFor="confirm-new-password">Confirm new password</label>
          <input autoComplete="new-password" id="confirm-new-password" minLength={PASSWORD_MIN_LENGTH} name="confirmPassword" required type="password" />
        </div>
      </div>
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export function AccountSecurityPanel({
  available,
  initialSetup,
  totpEnabled,
  username,
}: {
  available: boolean;
  initialSetup: TotpSetup | null;
  totpEnabled: boolean;
  username: string;
}) {
  return (
    <section aria-labelledby="account-security" className="settings-section account-security">
      <h2 id="account-security">Account security</h2>
      <p className="settings-help">
        Username <code>{username}</code>. Job Pilot never asks for an account email.
      </p>
      <p className={`chip account-security-status ${totpEnabled ? "account-security-status--enabled" : ""}`}>
        <StateIcon success={totpEnabled} />
        {totpEnabled ? "Authenticator enabled" : "Authenticator not set up"}
      </p>
      {totpEnabled ? (
        <PasswordChangeForm />
      ) : (
        <>
          <TotpSkippedWarning />
          <TotpSetupPanel available={available} initialSetup={initialSetup} />
        </>
      )}
    </section>
  );
}
