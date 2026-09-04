import { redirect } from "next/navigation";
import Link from "next/link";

import {
  currentIncompleteSignupTenant,
  currentTenant,
} from "@/server/auth/current-session";

const AUTH_STATES = new Set([
  "sign-in",
  "sign-up",
  "forgot-password",
  "setup-totp",
]);

export default async function LandingPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ auth?: string }>;
} = {}) {
  if (await currentTenant()) redirect("/today");

  const incomplete = await currentIncompleteSignupTenant();
  const requested = (await searchParams).auth;
  const initialAuth = incomplete
    ? "setup-totp"
    : requested && AUTH_STATES.has(requested)
      ? requested
      : "";

  return (
    <main
      className="landing-placeholder"
      data-initial-auth={initialAuth}
      id="main-content"
      tabIndex={-1}
    >
      <p className="eyebrow">Your private job-search command center</p>
      <h1>Run your job search from one clear workspace</h1>
      <p>
        Track relationships, roles, follow-ups and decisions without losing the
        next action.
      </p>
      <div>
        <Link className="btn" href="/?auth=sign-up">
          Create account
        </Link>
        <Link className="btn btn--ghost" href="/?auth=sign-in">
          Sign in
        </Link>
      </div>
    </main>
  );
}
