import type { Metadata } from "next";
import Link from "next/link";

import { AccountLifecycleForm } from "@/components/account-lifecycle-form";
import { ACCOUNT_MAIL_UNAVAILABLE_MESSAGE } from "@/lib/account";
import { configuredAccountMailPort } from "@/server/auth/account-mail";

export const metadata: Metadata = {
  title: "Reset password · Job Pilot",
};

export default function ForgotPasswordPage() {
  const available = configuredAccountMailPort() !== null;

  return (
    <section className="auth-card">
      <p className="eyebrow">Account recovery</p>
      <h1>Reset password</h1>
      <p className="auth-lede">
        {available
          ? "Enter your email. The response is the same whether or not an account matches."
          : ACCOUNT_MAIL_UNAVAILABLE_MESSAGE}
      </p>
      {available ? <AccountLifecycleForm mode="request-recovery" /> : null}
      <p className="auth-switch">
        Return to <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
