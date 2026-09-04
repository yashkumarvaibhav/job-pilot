import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PASSWORD_RESET_COMPLETE_MESSAGE,
  PASSWORD_RESET_FAILED_MESSAGE,
  PASSWORD_CHANGE_FAILED_MESSAGE,
  TOTP_CONFIRM_FAILED_MESSAGE,
} from "../../../lib/account";
import {
  confirmTotpEnrollment,
  readAccountSecurity,
  startTotpEnrollment,
} from "../../../server/auth/account-security";
import { registerAccount, authenticateAccount } from "../../../server/auth/accounts";
import { accountRateLimiter } from "../../../domain/rate-limit";
import { generateTotpCode } from "../../../server/auth/totp";
import {
  resolveEnrollmentSessionTenant,
  resolveSessionTenant,
  startSession,
} from "../../../server/auth/session";
import { openDatabase, type DatabaseClient } from "../../../server/db/client";
import { migrateDatabase } from "../../../server/db/migrate";
import type { TenantContext } from "../../../server/db/tenant";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: null as null | { userId: string; workspaceId: string },
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
vi.mock("@/server/auth/current-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../server/auth/current-session")>();
  return {
    ...original,
    currentTenant: async () => mocks.tenant,
    currentTotpEnrollmentTenant: async () => mocks.tenant,
    establishSession: async (userId: string) => mocks.cookieSet("session", userId),
  };
});

import { POST as changePassword } from "./password/change/route";
import { POST as resetPassword } from "./recovery/reset/route";
import { POST as signup } from "./signup/route";
import { POST as confirmTotp } from "./totp/confirm/route";
import { POST as setupTotp } from "./totp/setup/route";

const HOST = "https://jobpilot.invalid.test";
const PASSWORD = "synthetic-owner-password";
const NEXT_PASSWORD = "synthetic-next-password";
const RESET_PASSWORD = "synthetic-reset-password";
const TOKEN_KEY = Buffer.alloc(32, 31).toString("base64");
const AT = new Date("2026-09-04T09:00:00.000Z");

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

async function createEnabledAccount(
  client: DatabaseClient,
  username = "existing_owner",
): Promise<{ tenant: TenantContext; secret: string }> {
  const created = await registerAccount(client.db, { username, password: PASSWORD });
  if (!created.ok) throw new Error("fixture account was not created");
  const setup = startTotpEnrollment(client.db, created.tenant, {
    tokenKey: TOKEN_KEY,
    secretBytes: Buffer.from("12345678901234567890", "ascii"),
    now: AT,
  });
  if (!setup) throw new Error("fixture TOTP setup was not created");
  const code = generateTotpCode(setup.secret, AT);
  if (!confirmTotpEnrollment(client.db, created.tenant, code, { tokenKey: TOKEN_KEY, now: AT })) {
    throw new Error("fixture TOTP setup was not confirmed");
  }
  return { tenant: created.tenant, secret: setup.secret };
}

describe("username and TOTP account routes", () => {
  const cleanups: (() => void)[] = [];
  let client: DatabaseClient;
  const originalKey = process.env.TOKEN_KEY;

  beforeEach(() => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-account-security-route-"));
    const databasePath = join(directory, "test.sqlite");
    migrateDatabase(databasePath);
    client = openDatabase(databasePath);
    mocks.database = client.db;
    mocks.tenant = null;
    mocks.cookieSet.mockClear();
    mocks.cookieDelete.mockClear();
    process.env.TOKEN_KEY = TOKEN_KEY;
    for (const key of [
      "signup:ip:198.51.100.20",
      "signup:account:new_owner",
      "login:ip:198.51.100.21",
      "login:account:new_owner",
      "recovery:ip:198.51.100.22",
      "recovery:account:existing_owner",
      "recovery:account:missing_owner",
      "verification:ip:198.51.100.23",
    ]) {
      accountRateLimiter.reset(key);
    }
    cleanups.push(() => {
      client.close();
      rmSync(directory, { force: true, recursive: true });
    });
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (originalKey === undefined) delete process.env.TOKEN_KEY;
    else process.env.TOKEN_KEY = originalKey;
  });

  it("creates a username account, session and pending authenticator setup", async () => {
    const response = await post(
      signup,
      "/api/auth/signup",
      { username: "New_Owner", password: PASSWORD },
      "198.51.100.20",
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, redirect: "/?auth=setup-totp" });
    expect(mocks.cookieSet).toHaveBeenCalledOnce();
    const row = client.sqlite
      .prepare(
        "select username_normalized, totp_secret_blob, totp_enabled_at, signup_completed_at from user_account",
      )
      .get() as Record<string, unknown>;
    expect(row.username_normalized).toBe("new_owner");
    expect(typeof row.totp_secret_blob).toBe("string");
    expect(row.totp_enabled_at).toBeNull();
    expect(row.signup_completed_at).toBeNull();
  });

  it("rejects email-shaped signup identifiers without creating an account", async () => {
    const response = await post(
      signup,
      "/api/auth/signup",
      { username: "owner@invalid.test", password: PASSWORD },
      "198.51.100.20",
    );
    expect(response.status).toBe(400);
    expect(client.sqlite.prepare("select count(*) as count from user_account").get()).toEqual({
      count: 0,
    });
  });

  it("refuses signup before writing when the encryption key is unavailable", async () => {
    delete process.env.TOKEN_KEY;
    const response = await post(
      signup,
      "/api/auth/signup",
      { username: "new_owner", password: PASSWORD },
      "198.51.100.20",
    );
    expect(response.status).toBe(503);
    expect(client.sqlite.prepare("select count(*) as count from user_account").get()).toEqual({
      count: 0,
    });
  });

  it("starts and confirms setup only for the authenticated tenant", async () => {
    const created = await registerAccount(client.db, {
      username: "settings_owner",
      password: PASSWORD,
      completeSignup: false,
    });
    if (!created.ok) throw new Error("fixture account was not created");
    mocks.tenant = created.tenant;
    const enrollmentSession = startSession(client.db, created.tenant.userId);
    expect(resolveSessionTenant(client.db, enrollmentSession.token)).toBeNull();
    expect(resolveEnrollmentSessionTenant(client.db, enrollmentSession.token)).toEqual(
      created.tenant,
    );

    const setupResponse = await post(
      setupTotp,
      "/api/auth/totp/setup",
      {},
      "198.51.100.23",
    );
    expect(setupResponse.status).toBe(200);
    const setup = (await setupResponse.json()) as { secret: string; uri: string };
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/u);

    const code = generateTotpCode(setup.secret);
    const confirmResponse = await post(
      confirmTotp,
      "/api/auth/totp/confirm",
      { code },
      "198.51.100.23",
    );
    expect(confirmResponse.status).toBe(200);
    expect(readAccountSecurity(client.db, created.tenant, TOKEN_KEY)?.totpEnabled).toBe(true);
    expect(resolveSessionTenant(client.db, enrollmentSession.token)).toEqual(created.tenant);
    expect(resolveEnrollmentSessionTenant(client.db, enrollmentSession.token)).toBeNull();

    const repeated = await post(
      confirmTotp,
      "/api/auth/totp/confirm",
      { code },
      "198.51.100.23",
    );
    expect(repeated.status).toBe(400);
    expect(await repeated.json()).toEqual({ error: TOTP_CONFIRM_FAILED_MESSAGE });
  });

  it("resets with username and a replay-safe code while keeping failures generic", async () => {
    const account = await createEnabledAccount(client);
    const resetAt = new Date();
    const session = startSession(client.db, account.tenant.userId, { now: resetAt });
    const code = generateTotpCode(account.secret, resetAt);

    const reset = await post(
      resetPassword,
      "/api/auth/recovery/reset",
      { username: "existing_owner", code, password: RESET_PASSWORD },
      "198.51.100.22",
    );
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({
      ok: true,
      message: PASSWORD_RESET_COMPLETE_MESSAGE,
    });
    expect(resolveSessionTenant(client.db, session.token, resetAt)).toBeNull();
    expect(
      await authenticateAccount(client.db, {
        username: "existing_owner",
        password: RESET_PASSWORD,
      }),
    ).toEqual({ userId: account.tenant.userId, signupComplete: true });

    const replay = await post(
      resetPassword,
      "/api/auth/recovery/reset",
      { username: "existing_owner", code, password: NEXT_PASSWORD },
      "198.51.100.22",
    );
    const missing = await post(
      resetPassword,
      "/api/auth/recovery/reset",
      { username: "missing_owner", code, password: NEXT_PASSWORD },
      "198.51.100.22",
    );
    expect(replay.status).toBe(400);
    expect(missing.status).toBe(400);
    expect(await replay.json()).toEqual({ error: PASSWORD_RESET_FAILED_MESSAGE });
    expect(await missing.json()).toEqual({ error: PASSWORD_RESET_FAILED_MESSAGE });
  });

  it("changes a password only with the current password and TOTP, then signs out", async () => {
    const account = await createEnabledAccount(client, "change_owner");
    mocks.tenant = account.tenant;
    const changeAt = new Date();
    const code = generateTotpCode(account.secret, changeAt);
    const response = await post(
      changePassword,
      "/api/auth/password/change",
      { currentPassword: PASSWORD, code, newPassword: NEXT_PASSWORD },
      "198.51.100.23",
    );
    expect(response.status).toBe(200);
    expect(mocks.cookieDelete).toHaveBeenCalledWith("job_pilot_session");

    const bad = await post(
      changePassword,
      "/api/auth/password/change",
      { currentPassword: PASSWORD, code, newPassword: RESET_PASSWORD },
      "198.51.100.23",
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: PASSWORD_CHANGE_FAILED_MESSAGE });
  });
});
