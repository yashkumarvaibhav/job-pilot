import type { Metadata } from "next";
import Link from "next/link";

import { AccountLifecycleForm } from "@/components/account-lifecycle-form";

export const metadata: Metadata = {
  title: "Choose a new password · Job Pilot",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token?.trim();

  return (
    <section className="auth-card">
      <p className="eyebrow">Account recovery</p>
      <h1>Choose a new password</h1>
      <p className="auth-lede">
        {token
          ? "Using this link signs every existing session out."
          : "This reset link is missing its token. Request a new one."}
      </p>
      {token ? <AccountLifecycleForm mode="reset" token={token} /> : null}
      <p className="auth-switch">
        Return to <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
