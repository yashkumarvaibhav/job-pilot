import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TotpSetupPanel } from "@/components/account-security";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { readAccountSecurity } from "@/server/auth/account-security";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";

export const metadata: Metadata = {
  title: "Protect your account · Job Pilot",
};

export default async function SetupTotpPage() {
  const tenant = await requireTenant();
  const tokenKey = configuredAccountSecretKey();
  const security = readAccountSecurity(getDatabase(), tenant, tokenKey);
  if (security?.totpEnabled) redirect("/settings");

  return (
    <section className="account-setup-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Optional recovery</p>
          <h1>Protect your account</h1>
          <p className="page-lede">
            Add this key to an authenticator app. Job Pilot uses its current code only for
            password recovery and password changes; ordinary sign in stays username + password.
          </p>
        </div>
      </header>
      <section aria-labelledby="setup-authenticator" className="settings-section">
        <h2 id="setup-authenticator">Set up authenticator</h2>
        <TotpSetupPanel
          available={tokenKey !== null}
          initialSetup={security?.setup ?? null}
          onboarding
        />
      </section>
    </section>
  );
}
