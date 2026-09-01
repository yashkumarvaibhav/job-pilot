import type { Metadata } from "next";
import Link from "next/link";

import { AccountForm } from "@/components/account-form";
import { isDemoMode } from "@/server/demo-mode";

export const metadata: Metadata = {
  title: "Sign in · Job Pilot",
};

export default function LoginPage() {
  const demoMode = isDemoMode();
  const demoEmail = process.env.DEMO_ACCOUNT_EMAIL?.trim();

  return (
    <section className="auth-card">
      <p className="eyebrow">Your workspace</p>
      <h1>Sign in</h1>
      <p className="auth-lede">
        {demoMode
          ? `Demo environment — sign in with ${demoEmail ?? "the provided demo account"}.`
          : "Job Pilot keeps one private workspace for each account."}
      </p>
      <AccountForm mode="login" />
      {demoMode ? null : (
        <p className="auth-switch">
          No account yet? <Link href="/signup">Create account</Link>
        </p>
      )}
    </section>
  );
}
