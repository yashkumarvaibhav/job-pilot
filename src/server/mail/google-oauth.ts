import type { GmailOAuthConfig } from "./google-config";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GMAIL_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
] as const;

export type GoogleAccountGrant = {
  googleSub: string;
  email: string;
  refreshToken: string;
};

export class GoogleOAuthError extends Error {
  constructor(message = "Google could not complete this Gmail connection.") {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

function redirectUri(config: GmailOAuthConfig): string {
  try {
    const uri = new URL(config.redirectUri);
    const local = uri.hostname === "127.0.0.1" || uri.hostname === "localhost";
    if (
      uri.pathname !== "/api/gmail/callback" ||
      (uri.protocol !== "https:" && !(local && uri.protocol === "http:"))
    ) {
      throw new Error("unsupported redirect URI");
    }
    return uri.toString();
  } catch {
    throw new GoogleOAuthError("GOOGLE_REDIRECT_URI is not a valid Gmail callback URL.");
  }
}

export function buildGoogleAuthorizationUrl(
  config: GmailOAuthConfig,
  state: string,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_OAUTH_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function exchangeGoogleAuthorizationCode(
  config: GmailOAuthConfig,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleAccountGrant> {
  const tokenResponse = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(config),
    }),
    cache: "no-store",
  });
  const tokens = await responseJson(tokenResponse);
  if (
    !tokenResponse.ok ||
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    throw new GoogleOAuthError(
      "Google did not return offline access. Remove the existing grant and try again.",
    );
  }

  const identityResponse = await fetcher(USERINFO_URL, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    cache: "no-store",
  });
  const identity = await responseJson(identityResponse);
  if (
    !identityResponse.ok ||
    typeof identity.sub !== "string" ||
    identity.sub.length === 0 ||
    typeof identity.email !== "string" ||
    identity.email.length === 0 ||
    identity.email_verified !== true
  ) {
    throw new GoogleOAuthError("Google did not return a verified account identity.");
  }

  return {
    googleSub: identity.sub,
    email: identity.email,
    refreshToken: tokens.refresh_token,
  };
}
