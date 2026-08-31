import type { Metadata } from "next";
import Link from "next/link";

import { AccountForm } from "@/components/account-form";

export const metadata: Metadata = {
  title: "Sign in · Job Pilot",
};

export default function LoginPage() {
  return (
    <section className="auth-card">
      <p className="eyebrow">Your workspace</p>
      <h1>Sign in</h1>
      <p className="auth-lede">
        Job Pilot keeps one private workspace for each account.
      </p>
      <AccountForm mode="login" />
      <p className="auth-switch">
        No account yet? <Link href="/signup">Create account</Link>
      </p>
    </section>
  );
}
