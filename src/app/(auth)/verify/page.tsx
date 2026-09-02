import type { Metadata } from "next";
import Link from "next/link";

import { AccountLifecycleForm } from "@/components/account-lifecycle-form";
import { ACCOUNT_MAIL_UNAVAILABLE_MESSAGE } from "@/lib/account";
import { configuredAccountMailPort } from "@/server/auth/account-mail";

export const metadata: Metadata = {
  title: "Verify email · Job Pilot",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token?.trim();
  const canResend = configuredAccountMailPort() !== null;

  return (
    <section className="auth-card">
      <p className="eyebrow">Account verification</p>
      <h1>Verify email</h1>
      <p className="auth-lede">
        {token
          ? "Confirm this single-use link to finish securing your account."
          : canResend
            ? "Request a fresh link. The response does not confirm whether an account exists."
            : ACCOUNT_MAIL_UNAVAILABLE_MESSAGE}
      </p>
      {token ? (
        <AccountLifecycleForm mode="verify" token={token} />
      ) : canResend ? (
        <AccountLifecycleForm mode="request-verification" />
      ) : null}
      <p className="auth-switch">
        Return to <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
