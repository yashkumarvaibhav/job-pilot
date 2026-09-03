import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  currentTenant,
  readSessionToken,
} from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readGmailOAuthConfig } from "@/server/mail/google-config";
import {
  exchangeGoogleAuthorizationCode,
  GoogleOAuthError,
} from "@/server/mail/google-oauth";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GmailOAuthStateError,
  validateGmailOAuthState,
} from "@/server/mail/oauth-state";
import {
  connectEmailAccount,
  readEmailAccountGoogleSubject,
} from "@/server/repos/email-accounts";

export const runtime = "nodejs";

function callbackError(message: string, status = 400): NextResponse {
  const response = NextResponse.json({ error: message }, { status });
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/gmail",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const tenant = await currentTenant();
  const sessionToken = await readSessionToken();
  if (!tenant || !sessionToken) {
    return callbackError("Authentication required.", 401);
  }
  const config = readGmailOAuthConfig();
  if (!config) {
    return callbackError(
      "Gmail connection is not configured on this deployment.",
      503,
    );
  }

  const search = new URL(request.url).searchParams;
  if (search.has("error")) {
    return callbackError("Google did not grant Gmail access.");
  }
  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) {
    return callbackError("The Gmail callback is missing required values.");
  }

  const jar = await cookies();
  try {
    const intent = validateGmailOAuthState({
      state,
      cookieValue: jar.get(GMAIL_OAUTH_STATE_COOKIE)?.value,
      tenant,
      sessionToken,
      tokenKey: config.tokenKey,
    });
    const grant = await exchangeGoogleAuthorizationCode(config, code);
    if (intent.kind === "reconnect") {
      const expectedSubject = readEmailAccountGoogleSubject(
        getDatabase(),
        tenant,
        intent.accountId,
      );
      if (!expectedSubject || expectedSubject !== grant.googleSub) {
        return callbackError(
          "Choose the same Google account when reconnecting this address.",
        );
      }
    }
    connectEmailAccount(getDatabase(), tenant, grant, config.tokenKey);

    const success = new URL("/settings", config.redirectUri);
    success.searchParams.set("gmail", "connected");
    const response = NextResponse.redirect(success);
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: success.protocol === "https:",
      path: "/api/gmail",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (
      error instanceof GmailOAuthStateError ||
      error instanceof GoogleOAuthError
    ) {
      return callbackError(error.message);
    }
    throw error;
  }
}
