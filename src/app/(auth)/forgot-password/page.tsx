import type { Metadata } from "next";
import Link from "next/link";

import { PasswordRecoveryForm } from "@/components/password-recovery-form";

export const metadata: Metadata = {
  title: "Reset password · Job Pilot",
};

export default function ForgotPasswordPage() {
  return (
    <section className="auth-card">
      <p className="eyebrow">Account recovery</p>
      <h1>Reset password</h1>
      <p className="auth-lede">
        Enter your username, a current code from the authenticator you previously set up,
        and a new password. Without that authenticator, this account cannot be recovered.
      </p>
      <PasswordRecoveryForm />
      <p className="auth-switch">
        Return to <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
