"use client";

import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  Check,
  ContactRound,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { TotpSetup } from "@/server/auth/totp";
import { AccountForm } from "./account-form";
import { TotpSetupPanel } from "./account-security";
import { BrandMark } from "./brand-mark";
import { PasswordRecoveryForm } from "./password-recovery-form";
import { trapDialogTab } from "./quick-add-dialog";
import { SignupProgress } from "./signup-progress";
import { ThemeToggle } from "./theme-toggle";

export type LandingAuthMode =
  | "sign-in"
  | "sign-up"
  | "forgot-password"
  | "setup-totp";

const AUTH_QUERY: Record<LandingAuthMode, string> = {
  "sign-in": "/?auth=sign-in",
  "sign-up": "/?auth=sign-up",
  "forgot-password": "/?auth=forgot-password",
  "setup-totp": "/?auth=setup-totp",
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function AuthDialog({
  demoAccount,
  mode,
  onAbandoned,
  onClose,
  onNavigate,
  setupAvailable,
  signupAvailable,
  totpSetup,
}: {
  demoAccount: string | null;
  mode: LandingAuthMode;
  onAbandoned: () => void;
  onClose: () => void;
  onNavigate: (mode: LandingAuthMode, replace?: boolean) => void;
  setupAvailable: boolean;
  signupAvailable: boolean;
  totpSetup: TotpSetup | null;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [abandonPending, setAbandonPending] = useState(false);
  const [abandonError, setAbandonError] = useState<string | null>(null);
  const dismissible = mode !== "setup-totp";

  async function abandonSignup() {
    setAbandonPending(true);
    setAbandonError(null);

    try {
      const response = await fetch("/api/auth/signup/abandon", { method: "POST" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body &&
          typeof body === "object" &&
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "Could not delete the incomplete account. Please retry.";
        setAbandonError(message);
        return;
      }

      onAbandoned();
    } catch {
      setAbandonError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setAbandonPending(false);
    }
  }

  useEffect(() => {
    const landing = document.querySelector<HTMLElement>(".landing-surface");
    const skipLink = document.querySelector<HTMLElement>(".skip-link");
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    landing?.setAttribute("inert", "");
    skipLink?.setAttribute("inert", "");

    return () => {
      document.body.style.overflow = previousOverflow;
      landing?.removeAttribute("inert");
      skipLink?.removeAttribute("inert");
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const first =
        dialog?.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmAbandon, mode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (dismissible) onClose();
        return;
      }
      trapDialogTab(dialog, event, document.activeElement);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismissible, onClose]);

  return (
    <div
      className="auth-dialog-backdrop"
      onPointerDown={(event) => {
        if (dismissible && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="account-dialog-title"
        aria-modal="true"
        className={mode === "setup-totp" ? "auth-dialog auth-dialog--wide" : "auth-dialog"}
        data-auth-mode={mode}
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label={
            mode === "setup-totp"
              ? confirmAbandon
                ? "Return to authenticator setup"
                : "Cancel account setup"
              : "Close account access"
          }
          className="auth-dialog-close"
          disabled={mode === "setup-totp" && confirmAbandon && abandonPending}
          onClick={() => {
            if (mode !== "setup-totp") {
              onClose();
              return;
            }
            setAbandonError(null);
            setConfirmAbandon((current) => !current);
          }}
          type="button"
        >
          <X aria-hidden="true" />
        </button>

        <div className="auth-dialog-content" key={mode}>
          {mode === "sign-in" ? (
            <section className="auth-card">
              <p className="eyebrow">Your workspace</p>
              <h2 id="account-dialog-title">Sign in</h2>
              <p className="auth-lede">
                {demoAccount
                  ? `Demo environment — sign in with ${demoAccount}.`
                  : "Open the private workspace that belongs only to your account."}
              </p>
              <AccountForm mode="login" />
              <div className="auth-dialog-links">
                <button
                  className="auth-inline-action"
                  onClick={() => onNavigate("forgot-password")}
                  type="button"
                >
                  Forgot password?
                </button>
                {signupAvailable ? (
                  <p>
                    No account yet?{" "}
                    <button
                      className="auth-inline-action"
                      onClick={() => onNavigate("sign-up")}
                      type="button"
                    >
                      Create account
                    </button>
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {mode === "sign-up" ? (
            <section className="auth-card">
              {signupAvailable ? (
                <>
                  <SignupProgress currentStep={1} />
                  <p className="eyebrow">Step 1 of 2</p>
                  <h2 id="account-dialog-title">Create account</h2>
                  <p className="auth-lede">
                    Choose your credentials. Next, scan a QR code before the private
                    workspace opens.
                  </p>
                  <AccountForm mode="signup" />
                  <p className="auth-dialog-switch">
                    Already registered?{" "}
                    <button
                      className="auth-inline-action"
                      onClick={() => onNavigate("sign-in")}
                      type="button"
                    >
                      Sign in
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <p className="eyebrow">Demo account only</p>
                  <h2 id="account-dialog-title">Account creation unavailable</h2>
                  <p className="auth-lede">
                    Public account creation is closed for this demo.
                  </p>
                  <button
                    className="btn btn--ghost"
                    onClick={() => onNavigate("sign-in")}
                    type="button"
                  >
                    Sign in
                  </button>
                </>
              )}
            </section>
          ) : null}

          {mode === "forgot-password" ? (
            <section className="auth-card">
              <p className="eyebrow">Account recovery</p>
              <h2 id="account-dialog-title">Reset password</h2>
              <p className="auth-lede">
                Use your username and current authenticator code. Without that
                authenticator, this account cannot be recovered.
              </p>
              <PasswordRecoveryForm
                onSignIn={() => onNavigate("sign-in")}
              />
              <p className="auth-dialog-switch">
                Return to{" "}
                <button
                  className="auth-inline-action"
                  onClick={() => onNavigate("sign-in")}
                  type="button"
                >
                  Sign in
                </button>
              </p>
            </section>
          ) : null}

          {mode === "setup-totp" ? (
            <section
              className={`auth-card auth-card--wide${confirmAbandon ? " auth-card--abandon" : ""}`}
            >
              {confirmAbandon ? (
                <>
                  <p className="eyebrow">Leave signup</p>
                  <h2 id="account-dialog-title">Delete incomplete account?</h2>
                  <p className="auth-lede">
                    You have not finished creating this account. You can return to
                    the authenticator step, or permanently delete this incomplete
                    account and its empty private workspace.
                  </p>
                  <div className="auth-abandon-warning" data-tone="danger">
                    <TriangleAlert aria-hidden="true" />
                    <div>
                      <strong>This cannot be undone</strong>
                      <p>
                        The username becomes available again. No completed account
                        can be deleted from this popup.
                      </p>
                    </div>
                  </div>
                  {abandonError ? (
                    <p className="form-alert" role="alert">
                      <TriangleAlert aria-hidden="true" />
                      <span>{abandonError}</span>
                    </p>
                  ) : null}
                  <div className="auth-abandon-actions">
                    <button
                      className="btn"
                      data-dialog-initial-focus
                      disabled={abandonPending}
                      onClick={() => {
                        setAbandonError(null);
                        setConfirmAbandon(false);
                      }}
                      type="button"
                    >
                      Keep setting up
                    </button>
                    <button
                      className="btn btn--danger"
                      disabled={abandonPending}
                      onClick={abandonSignup}
                      type="button"
                    >
                      {abandonPending ? "Deleting…" : "Delete incomplete account"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <SignupProgress currentStep={2} />
                  <p className="eyebrow">Step 2 of 2</p>
                  <h2 id="account-dialog-title">Protect your account</h2>
                  <p className="auth-lede">
                    Scan once, confirm the current code, and your private workspace is
                    ready. This step cannot be skipped.
                  </p>
                  <TotpSetupPanel
                    available={setupAvailable}
                    initialSetup={totpSetup}
                    onboarding
                  />
                </>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function LandingExperience({
  authMode,
  demoAccount,
  setupAvailable,
  signupAvailable,
  totpSetup,
}: {
  authMode: LandingAuthMode | null;
  demoAccount: string | null;
  setupAvailable: boolean;
  signupAvailable: boolean;
  totpSetup: TotpSetup | null;
}) {
  const router = useRouter();
  const navigate = useCallback(
    (mode: LandingAuthMode, replace = false) => {
      if (replace) router.replace(AUTH_QUERY[mode]);
      else router.push(AUTH_QUERY[mode]);
    },
    [router],
  );
  const close = useCallback(() => router.replace("/"), [router]);
  const abandoned = useCallback(() => {
    router.replace("/");
    router.refresh();
  }, [router]);

  return (
    <>
      <div className="landing-surface">
        <header className="landing-nav">
          <a aria-label="Job Pilot home" className="brand-lockup" href="#top">
            <BrandMark />
            <span className="brand-wordmark">
              <strong>Job Pilot</strong>
            </span>
          </a>
          <nav aria-label="Landing navigation" className="landing-nav-links">
            <a href="#how-it-works">How it works</a>
            <button
              className="btn btn--ghost landing-sign-in"
              onClick={() => navigate("sign-in")}
              type="button"
            >
              Sign in
            </button>
            {signupAvailable ? (
              <button
                className="btn landing-create"
                onClick={() => navigate("sign-up")}
                type="button"
              >
                Create account
              </button>
            ) : null}
            <ThemeToggle />
          </nav>
        </header>

        <main id="main-content" tabIndex={-1}>
          <section className="landing-hero" id="top">
            <div className="landing-hero-copy">
              <p className="eyebrow">Private workspace · deliberate progress</p>
              <h1>Run your job search from one clear workspace</h1>
              <p className="landing-lede">
                Turn scattered roles, conversations, referrals and follow-ups into
                one focused plan for what to do next.
              </p>
              <div className="landing-actions">
                {signupAvailable ? (
                  <button
                    className="btn landing-primary-action"
                    onClick={() => navigate("sign-up")}
                    type="button"
                  >
                    Create your workspace
                    <ArrowRight aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  className="btn btn--ghost"
                  onClick={() => navigate("sign-in")}
                  type="button"
                >
                  Sign in
                </button>
              </div>
              <p className="landing-assurance">
                <ShieldCheck aria-hidden="true" />
                Private by default. Authenticator protected. No shared workspace.
              </p>
            </div>

            <aside aria-label="Workflow preview" className="landing-preview">
              <header className="landing-preview-header">
                <div>
                  <p className="eyebrow">Workflow preview</p>
                  <h2>Today, with the noise removed</h2>
                </div>
                <span className="chip chip--outline">Your next actions</span>
              </header>
              <div className="landing-preview-list">
                <article>
                  <CalendarCheck2 aria-hidden="true" />
                  <div>
                    <span>Follow up</span>
                    <strong>Keep warm conversations moving</strong>
                  </div>
                  <span className="landing-preview-state"><Check aria-hidden="true" /> Due work</span>
                </article>
                <article>
                  <BriefcaseBusiness aria-hidden="true" />
                  <div>
                    <span>Review pipeline</span>
                    <strong>See every role and its real stage</strong>
                  </div>
                  <span className="landing-preview-state"><Check aria-hidden="true" /> Connected</span>
                </article>
                <article>
                  <MailCheck aria-hidden="true" />
                  <div>
                    <span>Review message</span>
                    <strong>Approve the exact email before sending</strong>
                  </div>
                  <span className="landing-preview-state"><LockKeyhole aria-hidden="true" /> Approval required</span>
                </article>
              </div>
              <footer className="landing-preview-footer">
                <span><ContactRound aria-hidden="true" /> Contacts</span>
                <span><BriefcaseBusiness aria-hidden="true" /> Opportunities</span>
                <span><CalendarCheck2 aria-hidden="true" /> Today</span>
              </footer>
            </aside>
          </section>

          <section className="landing-principles" aria-label="Product principles">
            <article>
              <ShieldCheck aria-hidden="true" />
              <div><strong>Private by default</strong><span>One account, one isolated workspace.</span></div>
            </article>
            <article>
              <CalendarCheck2 aria-hidden="true" />
              <div><strong>Action over clutter</strong><span>Today answers what needs attention.</span></div>
            </article>
            <article>
              <MailCheck aria-hidden="true" />
              <div><strong>You approve every send</strong><span>No automatic third-party replies.</span></div>
            </article>
          </section>

          <section className="landing-section" id="how-it-works">
            <div className="landing-section-heading">
              <p className="eyebrow">One connected operating loop</p>
              <h2>From first conversation to final decision</h2>
              <p>
                Job Pilot keeps the context around your search connected, then
                brings the next meaningful action forward.
              </p>
            </div>
            <div className="landing-feature-grid">
              <article>
                <span className="landing-feature-number tnum">01</span>
                <ContactRound aria-hidden="true" />
                <h3>Build real relationships</h3>
                <p>Keep companies, people, interactions and referrals together.</p>
              </article>
              <article>
                <span className="landing-feature-number tnum">02</span>
                <BriefcaseBusiness aria-hidden="true" />
                <h3>Move every role forward</h3>
                <p>Track opportunities, applications, assessments and interviews.</p>
              </article>
              <article>
                <span className="landing-feature-number tnum">03</span>
                <CalendarCheck2 aria-hidden="true" />
                <h3>Know what comes next</h3>
                <p>Turn follow-up dates and deadlines into a focused daily queue.</p>
              </article>
            </div>
          </section>

          <section className="landing-safety">
            <div>
              <p className="eyebrow">Deliberately human controlled</p>
              <h2>Every third-party message waits for your approval</h2>
            </div>
            <p>
              Job Pilot can organize due work and prepare a draft, but the account
              owner reviews the exact recipient, subject, body, attachments and time
              before a message is allowed to send.
            </p>
          </section>

          <section className="landing-final-cta">
            <p className="eyebrow">Start with the next action</p>
            <h2>Your search deserves a system, not another scattered list.</h2>
            <div className="landing-actions">
              {signupAvailable ? (
                <button className="btn" onClick={() => navigate("sign-up")} type="button">
                  Create account
                </button>
              ) : null}
              <button className="btn btn--ghost" onClick={() => navigate("sign-in")} type="button">
                Sign in
              </button>
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <span className="brand-wordmark"><strong>Job Pilot</strong></span>
          <p>A private operating system for the off-campus job search.</p>
        </footer>
      </div>

      {authMode ? (
        <AuthDialog
          demoAccount={demoAccount}
          mode={authMode}
          onAbandoned={abandoned}
          onClose={close}
          onNavigate={navigate}
          setupAvailable={setupAvailable}
          signupAvailable={signupAvailable}
          totpSetup={totpSetup}
        />
      ) : null}
    </>
  );
}
