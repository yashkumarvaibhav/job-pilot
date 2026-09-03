import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTenantTestFixture } from "../../../test/tenant-fixture";
import {
  connectEmailAccount,
  listEmailAccounts,
} from "../../../server/repos/email-accounts";
import {
  createGmailOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
} from "../../../server/mail/oauth-state";

const TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: undefined as unknown,
  sessionToken: "session-a" as string | undefined,
  oauthCookie: undefined as string | undefined,
  exchange: vi.fn(),
}));

vi.mock("@/server/auth/current-session", () => ({
  currentTenant: async () => mocks.tenant,
  readSessionToken: async () => mocks.sessionToken,
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === GMAIL_OAUTH_STATE_COOKIE && mocks.oauthCookie
        ? { value: mocks.oauthCookie }
        : undefined,
  }),
}));
vi.mock("@/server/mail/google-oauth", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../server/mail/google-oauth")
  >();
  return { ...actual, exchangeGoogleAuthorizationCode: mocks.exchange };
});

import { GET as connect } from "./connect/route";
import { GET as callback } from "./callback/route";

const ORIGIN = "https://jobpilot.invalid.test";

describe("Gmail OAuth routes", () => {
  const fixtures: { dispose: () => void }[] = [];

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", `${ORIGIN}/api/gmail/callback`);
    vi.stubEnv("TOKEN_KEY", TOKEN_KEY);
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);
    mocks.database = fixture.client.db;
    mocks.tenant = fixture.tenantA;
    mocks.sessionToken = "session-a";
    mocks.oauthCookie = undefined;
    mocks.exchange.mockReset();
  });

  afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.dispose();
    vi.unstubAllEnvs();
  });

  it("requires the initiating Job Pilot session", async () => {
    mocks.tenant = null;
    mocks.sessionToken = undefined;

    expect(
      (await connect(new Request(`${ORIGIN}/api/gmail/connect`))).status,
    ).toBe(401);
    expect(
      (await callback(new Request(`${ORIGIN}/api/gmail/callback`))).status,
    ).toBe(401);
  });

  it("starts offline consent with an HttpOnly state cookie", async () => {
    const response = await connect(
      new Request(`${ORIGIN}/api/gmail/connect`),
    );

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("state")).toBeTruthy();
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${GMAIL_OAUTH_STATE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects missing state and a valid state from another workspace", async () => {
    const fixture = createTenantTestFixture();
    fixtures.push(fixture);

    expect(
      (
        await callback(
          new Request(`${ORIGIN}/api/gmail/callback?code=one-time-code`),
        )
      ).status,
    ).toBe(400);

    const pending = createGmailOAuthState({
      tenant: fixture.tenantA,
      sessionToken: "session-a",
      tokenKey: TOKEN_KEY,
      intent: { kind: "connect" },
    });
    mocks.oauthCookie = pending.cookieValue;
    mocks.tenant = fixture.tenantB;
    mocks.database = fixture.client.db;
    const response = await callback(
      new Request(
        `${ORIGIN}/api/gmail/callback?code=one-time-code&state=${encodeURIComponent(pending.state)}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(fixture.rowCount("email_account")).toBe(0);
  });

  it("stores a successful callback by stable Google subject without returning tokens", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const pending = createGmailOAuthState({
      tenant: fixture.tenantA,
      sessionToken: "session-a",
      tokenKey: TOKEN_KEY,
      intent: { kind: "connect" },
    });
    mocks.oauthCookie = pending.cookieValue;
    mocks.exchange.mockResolvedValue({
      googleSub: "google-user-a",
      email: "owner@invalid.test",
      refreshToken: "synthetic-refresh",
    });

    const response = await callback(
      new Request(
        `${ORIGIN}/api/gmail/callback?code=one-time-code&state=${encodeURIComponent(pending.state)}`,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/settings?gmail=connected`,
    );
    const listed = listEmailAccounts(fixture.client.db, fixture.tenantA);
    expect(listed).toEqual([
      expect.objectContaining({ email: "owner@invalid.test", status: "connected" }),
    ]);
    expect(JSON.stringify(listed)).not.toContain("synthetic-refresh");
  });

  it("does not retarget reconnect intent to a different Google identity", async () => {
    const fixture = fixtures[0] as ReturnType<typeof createTenantTestFixture>;
    const account = connectEmailAccount(
      fixture.client.db,
      fixture.tenantA,
      {
        googleSub: "expected-google-user",
        email: "expected@invalid.test",
        refreshToken: "old-refresh",
      },
      TOKEN_KEY,
    );
    const pending = createGmailOAuthState({
      tenant: fixture.tenantA,
      sessionToken: "session-a",
      tokenKey: TOKEN_KEY,
      intent: { kind: "reconnect", accountId: account.id },
    });
    mocks.oauthCookie = pending.cookieValue;
    mocks.exchange.mockResolvedValue({
      googleSub: "different-google-user",
      email: "different@invalid.test",
      refreshToken: "different-refresh",
    });

    const response = await callback(
      new Request(
        `${ORIGIN}/api/gmail/callback?code=one-time-code&state=${encodeURIComponent(pending.state)}`,
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose the same Google account when reconnecting this address.",
    });
    expect(listEmailAccounts(fixture.client.db, fixture.tenantA)).toEqual([
      expect.objectContaining({
        id: account.id,
        email: "expected@invalid.test",
      }),
    ]);
  });
});
