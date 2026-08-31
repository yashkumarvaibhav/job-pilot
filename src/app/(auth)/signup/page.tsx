import type { Metadata } from "next";
import Link from "next/link";

import { AccountForm } from "@/components/account-form";

export const metadata: Metadata = {
  title: "Create account · Job Pilot",
};

export default function SignupPage() {
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
