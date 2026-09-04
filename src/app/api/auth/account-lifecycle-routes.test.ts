import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_MAIL_UNAVAILABLE_MESSAGE,
  RECOVERY_REQUESTED_MESSAGE,
  SIGNUP_CHECK_EMAIL_MESSAGE,
} from "../../../lib/account";
import { registerAccount } from "../../../server/auth/accounts";
import { accountRateLimiter } from "../../../domain/rate-limit";
import { openDatabase, type DatabaseClient } from "../../../server/db/client";
import { migrateDatabase } from "../../../server/db/migrate";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  mailPort: null as null | {
    sendVerification: ReturnType<typeof vi.fn>;
    sendPasswordReset: ReturnType<typeof vi.fn>;
  },
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: mocks.cookieSet,
    delete: mocks.cookieDelete,
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/auth/account-mail", () => ({
  configuredAccountMailPort: () => mocks.mailPort,
}));

import { POST as login } from "./login/route";
import { POST as resetPassword } from "./recovery/reset/route";
import { POST as requestRecovery } from "./recovery/request/route";
import { POST as signup } from "./signup/route";
import { POST as verify } from "./verify/route";
import { POST as requestVerification } from "./verification/request/route";

const HOST = "https://jobpilot.invalid.test";
const PASSWORD = "synthetic-owner-password";
const NEXT_PASSWORD = "synthetic-next-password";

function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  ip: string,
) {
  return handler(
    new Request(`${HOST}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify(body),
    }),
  );
}

function deliveryToken(mock: ReturnType<typeof vi.fn>): string {
  const delivery = mock.mock.calls.at(-1)?.[0] as { url?: string } | undefined;
  const token = delivery?.url
    ? new URL(delivery.url).searchParams.get("token")
    : null;
  if (!token) throw new Error("No captured fixture token.");
  return token;
}

describe("account lifecycle routes", () => {
  const cleanups: (() => void)[] = [];
  let client: DatabaseClient;

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-lifecycle-route-"));
    const databasePath = join(directory, "test.sqlite");
    migrateDatabase(databasePath);
    client = openDatabase(databasePath);
    mocks.database = client.db;
    mocks.mailPort = {
      sendVerification: vi.fn().mockResolvedValue(undefined),
      sendPasswordReset: vi.fn().mockResolvedValue(undefined),
    };
    mocks.cookieSet.mockClear();
    mocks.cookieDelete.mockClear();
    cleanups.push(() => {
      client.close();
      rmSync(directory, { force: true, recursive: true });
    });

    await registerAccount(client.db, {
      email: "existing@invalid.test",
      password: PASSWORD,
    });
    for (const key of [
      "signup:ip:198.51.100.20",
      "signup:account:new@invalid.test",
      "verification:ip:198.51.100.21",
      "verification:account:existing@invalid.test",
      "recovery:ip:198.51.100.22",
      "recovery:ip:198.51.100.23",
      "recovery:ip:198.51.100.24",
      "recovery:account:existing@invalid.test",
      "recovery:account:missing@invalid.test",
      "login:ip:198.51.100.25",
      "login:account:new@invalid.test",
    ]) {
      accountRateLimiter.reset(key);
    }
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("opens account access while mail-only entry points remain closed", async () => {
    mocks.mailPort = null;

    const signupResponse = await post(
      signup,
      "/api/auth/signup",
      { email: "new@invalid.test", password: PASSWORD },
      "198.51.100.20",
    );
    expect(signupResponse.status).toBe(201);
    expect(await signupResponse.json()).toEqual({ ok: true });
    expect(mocks.cookieSet).toHaveBeenCalledOnce();

    const mailResponses = await Promise.all([
      post(
        requestVerification,
        "/api/auth/verification/request",
        { email: "existing@invalid.test" },
        "198.51.100.21",
      ),
      post(
        requestRecovery,
        "/api/auth/recovery/request",
        { email: "existing@invalid.test" },
        "198.51.100.22",
      ),
    ]);

    for (const response of mailResponses) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: ACCOUNT_MAIL_UNAVAILABLE_MESSAGE,
      });
    }
    expect(
      client.sqlite.prepare("select count(*) as count from user_account").get(),
    ).toEqual({ count: 2 });
    expect(
      client.sqlite.prepare("select count(*) as count from account_token").get(),
    ).toEqual({ count: 0 });
    expect(
      client.sqlite
        .prepare("select email_verified_at from user_account where email_normalized = ?")
        .get("new@invalid.test"),
    ).toEqual({ email_verified_at: null });

    const loginResponse = await post(
      login,
      "/api/auth/login",
      { email: "new@invalid.test", password: PASSWORD },
      "198.51.100.25",
    );
    expect(loginResponse.status).toBe(200);
  });

  it("creates an unverified account, verifies once, then permits login", async () => {
    const response = await post(
      signup,
      "/api/auth/signup",
      { email: "new@invalid.test", password: PASSWORD },
      "198.51.100.20",
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      message: SIGNUP_CHECK_EMAIL_MESSAGE,
    });
    expect(mocks.mailPort?.sendVerification).toHaveBeenCalledOnce();
    expect(mocks.cookieSet).not.toHaveBeenCalled();

    const before = await post(
      login,
      "/api/auth/login",
      { email: "new@invalid.test", password: PASSWORD },
      "198.51.100.25",
    );
    expect(before.status).toBe(401);

    const token = deliveryToken(mocks.mailPort!.sendVerification);
    expect(
      (
        await post(
          verify,
          "/api/auth/verify",
          { token },
          "198.51.100.21",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          verify,
          "/api/auth/verify",
          { token },
          "198.51.100.21",
        )
      ).status,
    ).toBe(400);

    const after = await post(
      login,
      "/api/auth/login",
      { email: "new@invalid.test", password: PASSWORD },
      "198.51.100.25",
    );
    expect(after.status).toBe(200);
    expect(mocks.cookieSet).toHaveBeenCalledOnce();
  });

  it("uses identical recovery responses and resets only the matching account", async () => {
    const missing = await post(
      requestRecovery,
      "/api/auth/recovery/request",
      { email: "missing@invalid.test" },
      "198.51.100.23",
    );
    const existing = await post(
      requestRecovery,
      "/api/auth/recovery/request",
      { email: "existing@invalid.test" },
      "198.51.100.24",
    );

    expect(missing.status).toBe(existing.status);
    expect(await missing.json()).toEqual(await existing.json());
    expect(await post(
      requestRecovery,
      "/api/auth/recovery/request",
      { email: "missing@invalid.test" },
      "198.51.100.23",
    ).then((response) => response.json())).toEqual({
      ok: true,
      message: RECOVERY_REQUESTED_MESSAGE,
    });
    expect(mocks.mailPort?.sendPasswordReset).toHaveBeenCalledOnce();

    const token = deliveryToken(mocks.mailPort!.sendPasswordReset);
    const reset = await post(
      resetPassword,
      "/api/auth/recovery/reset",
      { token, password: NEXT_PASSWORD },
      "198.51.100.22",
    );
    expect(reset.status).toBe(200);
    expect(mocks.cookieDelete).toHaveBeenCalledWith("job_pilot_session");
    expect(
      (
        await post(
          login,
          "/api/auth/login",
          { email: "existing@invalid.test", password: NEXT_PASSWORD },
          "198.51.100.25",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          resetPassword,
          "/api/auth/recovery/reset",
          { token, password: "another-valid-password" },
          "198.51.100.22",
        )
      ).status,
    ).toBe(400);
  });
});
