import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  type LandingAuthMode,
  LandingExperience,
} from "@/components/landing-experience";
import { configuredAccountSecretKey } from "@/server/auth/account-secret-key";
import { readAccountSecurity } from "@/server/auth/account-security";
import {
  currentIncompleteSignupTenant,
  currentTenant,
} from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { isDemoMode } from "@/server/demo-mode";

export const metadata: Metadata = {
  title: "Job Pilot · Run your job search from one clear workspace",
  description:
    "A private operating system for job-search relationships, opportunities, follow-ups and owner-approved outreach.",
};

const AUTH_STATES = new Set<LandingAuthMode>([
  "sign-in",
  "sign-up",
  "forgot-password",
]);

export default async function LandingPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ auth?: string }>;
} = {}) {
  if (await currentTenant()) redirect("/today");

  const incomplete = await currentIncompleteSignupTenant();
  const requested = (await searchParams).auth;
  const authMode: LandingAuthMode | null = incomplete
    ? "setup-totp"
    : requested && AUTH_STATES.has(requested as LandingAuthMode)
      ? requested as LandingAuthMode
      : null;
  const tokenKey = incomplete ? configuredAccountSecretKey() : null;
  const security = incomplete
    ? readAccountSecurity(getDatabase(), incomplete, tokenKey)
    : null;
  const demoMode = isDemoMode();

  return (
    <LandingExperience
      authMode={authMode}
      demoAccount={demoMode ? process.env.DEMO_ACCOUNT_EMAIL?.trim() ?? null : null}
      setupAvailable={tokenKey !== null}
      signupAvailable={!demoMode}
      totpSetup={security?.setup ?? null}
    />
  );
}
