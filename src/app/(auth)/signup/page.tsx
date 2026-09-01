import type { Metadata } from "next";
import Link from "next/link";

import { AccountForm } from "@/components/account-form";
import {
  DEMO_SIGNUP_CLOSED_MESSAGE,
  isDemoMode,
} from "@/server/demo-mode";

export const metadata: Metadata = {
  title: "Create account · Job Pilot",
};

export default function SignupPage() {
  if (isDemoMode()) {
    return (
      <section className="auth-card">
        <p className="eyebrow">Demo account only</p>
        <h1>Account creation unavailable</h1>
        <p className="auth-lede">{DEMO_SIGNUP_CLOSED_MESSAGE}</p>
        <p className="auth-switch">
          Return to <Link href="/login">Sign in</Link>
        </p>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Your workspace</p>
      <h1>Create account</h1>
      <p className="auth-lede">
        Creating an account opens one private workspace that only you can see.
      </p>
      <AccountForm mode="signup" />
      <p className="auth-switch">
        Already registered? <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
