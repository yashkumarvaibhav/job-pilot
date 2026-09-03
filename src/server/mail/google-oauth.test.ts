import { describe, expect, it, vi } from "vitest";

import type { GmailOAuthConfig } from "./google-config";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  GMAIL_OAUTH_SCOPES,
  GoogleOAuthError,
} from "./google-oauth";

const config: GmailOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://jobpilot.invalid.test/api/gmail/callback",
  tokenKey: Buffer.alloc(32, 5).toString("base64"),
};

describe("Google OAuth service", () => {
  it("requests only identity, Gmail send and read-only scopes with offline consent", () => {
    expect(GMAIL_OAUTH_SCOPES).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    const url = new URL(buildGoogleAuthorizationUrl(config, "signed-state"));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      GMAIL_OAUTH_SCOPES,
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.has("https://www.googleapis.com/auth/gmail.modify")).toBe(
      false,
    );
  });

  it("exchanges the code server-side and reads the stable Google subject", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "transient-access",
            refresh_token: "synthetic-refresh",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "google-user-1",
            email: "Person@Example.com",
            email_verified: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      exchangeGoogleAuthorizationCode(config, "one-time-code", fetcher),
    ).resolves.toEqual({
      googleSub: "google-user-1",
      email: "Person@Example.com",
      refreshToken: "synthetic-refresh",
    });
    const tokenRequest = fetcher.mock.calls[0];
    expect(tokenRequest?.[0]).toBe("https://oauth2.googleapis.com/token");
    expect(String(tokenRequest?.[1]?.body)).toContain("code=one-time-code");
    expect(String(tokenRequest?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      authorization: "Bearer transient-access",
    });
  });

  it("fails closed when Google omits offline access or verified identity", async () => {
    const missingRefresh = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-only" }), {
        status: 200,
      }),
    );
    await expect(
      exchangeGoogleAuthorizationCode(config, "code", missingRefresh),
    ).rejects.toThrow(GoogleOAuthError);

    const unverified = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access",
            refresh_token: "refresh",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: "google-user",
            email: "unverified@example.com",
            email_verified: false,
          }),
          { status: 200 },
        ),
      );
    await expect(
      exchangeGoogleAuthorizationCode(config, "code", unverified),
    ).rejects.toThrow(GoogleOAuthError);
  });
});
