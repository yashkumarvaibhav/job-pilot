import { describe, expect, it } from "vitest";

import { createTenantContext } from "../db/tenant";
import {
  createGmailOAuthState,
  GmailOAuthStateError,
  validateGmailOAuthState,
} from "./oauth-state";

const TOKEN_KEY = Buffer.alloc(32, 3).toString("base64");
const tenant = createTenantContext("user-a", "workspace-a");
const NOW = new Date("2026-09-03T12:00:00.000Z");

describe("Gmail OAuth state", () => {
  it("round-trips connect and reconnect intent for the initiating session", () => {
    for (const intent of [
      { kind: "connect" as const },
      { kind: "reconnect" as const, accountId: "account-a" },
    ]) {
      const pending = createGmailOAuthState({
        tenant,
        sessionToken: "session-a",
        tokenKey: TOKEN_KEY,
        intent,
        now: NOW,
      });

      expect(
        validateGmailOAuthState({
          state: pending.state,
          cookieValue: pending.cookieValue,
          tenant,
          sessionToken: "session-a",
          tokenKey: TOKEN_KEY,
          now: new Date(NOW.getTime() + 60_000),
        }),
      ).toEqual(intent);
    }
  });

  it("rejects missing, modified and expired state", () => {
    const pending = createGmailOAuthState({
      tenant,
      sessionToken: "session-a",
      tokenKey: TOKEN_KEY,
      intent: { kind: "connect" },
      now: NOW,
    });

    for (const attempt of [
      { state: "", cookieValue: pending.cookieValue, now: NOW },
      { state: `${pending.state}changed`, cookieValue: pending.cookieValue, now: NOW },
      {
        state: pending.state,
        cookieValue: pending.cookieValue,
        now: new Date(NOW.getTime() + 11 * 60_000),
      },
    ]) {
      expect(() =>
        validateGmailOAuthState({
          ...attempt,
          tenant,
          sessionToken: "session-a",
          tokenKey: TOKEN_KEY,
        }),
      ).toThrow(GmailOAuthStateError);
    }
  });

  it("rejects a missing browser cookie, another session and another workspace", () => {
    const pending = createGmailOAuthState({
      tenant,
      sessionToken: "session-a",
      tokenKey: TOKEN_KEY,
      intent: { kind: "connect" },
      now: NOW,
    });

    for (const attempt of [
      { cookieValue: undefined, sessionToken: "session-a", tenant },
      { cookieValue: pending.cookieValue, sessionToken: "session-b", tenant },
      {
        cookieValue: pending.cookieValue,
        sessionToken: "session-a",
        tenant: createTenantContext("user-b", "workspace-b"),
      },
    ]) {
      expect(() =>
        validateGmailOAuthState({
          state: pending.state,
          cookieValue: attempt.cookieValue,
          tenant: attempt.tenant,
          sessionToken: attempt.sessionToken,
          tokenKey: TOKEN_KEY,
          now: NOW,
        }),
      ).toThrow(GmailOAuthStateError);
    }
  });
});
