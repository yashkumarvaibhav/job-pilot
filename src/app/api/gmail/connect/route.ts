import { NextResponse } from "next/server";

import {
  currentTenant,
  readSessionToken,
} from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readGmailOAuthConfig } from "@/server/mail/google-config";
import { buildGoogleAuthorizationUrl } from "@/server/mail/google-oauth";
import {
  createGmailOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
  type GmailOAuthIntent,
} from "@/server/mail/oauth-state";
import { readEmailAccountGoogleSubject } from "@/server/repos/email-accounts";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const CONFIGURATION_REQUIRED = {
  error: "Gmail connection is not configured on this deployment.",
};

export async function GET(request: Request) {
  const tenant = await currentTenant();
  const sessionToken = await readSessionToken();
  if (!tenant || !sessionToken) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const config = readGmailOAuthConfig();
  if (!config) {
    return NextResponse.json(CONFIGURATION_REQUIRED, { status: 503 });
  }

  const accountId = new URL(request.url).searchParams.get("accountId")?.trim();
  let intent: GmailOAuthIntent = { kind: "connect" };
  if (accountId) {
    const owned = readEmailAccountGoogleSubject(
      getDatabase(),
      tenant,
      accountId,
    );
    if (!owned) {
      return NextResponse.json({ error: "Gmail account not found." }, { status: 404 });
    }
    intent = { kind: "reconnect", accountId };
  }

  const pending = createGmailOAuthState({
    tenant,
    sessionToken,
    tokenKey: config.tokenKey,
    intent,
  });
  const response = NextResponse.redirect(
    buildGoogleAuthorizationUrl(config, pending.state),
  );
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, pending.cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(config.redirectUri).protocol === "https:",
    path: "/api/gmail",
    expires: pending.expiresAt,
  });
  return response;
}
