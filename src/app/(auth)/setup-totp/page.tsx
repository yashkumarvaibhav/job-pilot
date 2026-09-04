import type { Metadata } from "next";

import { TotpSetupPanel } from "@/components/account-security";
import { SignupProgress } from "@/components/signup-progress";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { readAccountSecurity } from "@/server/auth/account-security";
import { requireIncompleteSignupTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";

export const metadata: Metadata = {
  title: "Protect your account · Job Pilot",
};

export default async function SetupTotpPage() {
  const tenant = await requireIncompleteSignupTenant();
  const tokenKey = configuredAccountSecretKey();
  const security = readAccountSecurity(getDatabase(), tenant, tokenKey);

  return (
    <section className="auth-card auth-card--wide">
      <SignupProgress currentStep={2} />
      <p className="eyebrow">Step 2 of 2</p>
      <h1>Protect your account</h1>
      <p className="auth-lede">
        Scan once, confirm the current code, and your private workspace is ready.
        Job Pilot uses the authenticator only for password recovery and changes.
      </p>
      <TotpSetupPanel
        available={tokenKey !== null}
        initialSetup={security?.setup ?? null}
        onboarding
      />
    </section>
  );
}
