import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_RATE_LIMITS,
  RATE_LIMITED_MESSAGE,
  accountRateLimiter,
} from "../../../domain/rate-limit";
import { registerAccount } from "../../../server/auth/accounts";
import { migrateDatabase } from "../../../server/db/migrate";
import { openDatabase, type DatabaseClient } from "../../../server/db/client";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  cookieSet: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: mocks.cookieSet,
    delete: vi.fn(),
  }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
import { POST as login } from "./login/route";
import { POST as signup } from "./signup/route";

const HOST = "https://jobpilot.invalid.test";
const TOKEN_KEY = Buffer.alloc(32, 27).toString("base64");

function attempt(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  ip = "198.51.100.7",
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

describe("account endpoint rate limiting", () => {
  const cleanups: (() => void)[] = [];
  let client: DatabaseClient;
  const originalKey = process.env.TOKEN_KEY;

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-account-"));
    const databasePath = join(directory, "test.sqlite");
    migrateDatabase(databasePath);
    client = openDatabase(databasePath);
    mocks.database = client.db;
    process.env.TOKEN_KEY = TOKEN_KEY;
    cleanups.push(() => {
      client.close();
      rmSync(directory, { force: true, recursive: true });
    });

    await registerAccount(client.db, {
      username: "real_owner",
      password: "synthetic-password-27",
    });
    // Each test starts from a clean process-wide counter.
    for (const key of [
      "login:ip:198.51.100.7",
      "login:ip:203.0.113.9",
      "login:account:real_owner",
      "login:account:missing_owner",
      "signup:ip:198.51.100.7",
      "signup:account:new_owner",
    ]) {
      accountRateLimiter.reset(key);
    }
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    mocks.cookieSet.mockClear();
    if (originalKey === undefined) delete process.env.TOKEN_KEY;
    else process.env.TOKEN_KEY = originalKey;
  });

  it("locks the attempt after the limit and says nothing about why", async () => {
    for (let index = 0; index < ACCOUNT_RATE_LIMITS.login.limit; index += 1) {
      const response = await attempt(login, "/api/auth/login", {
        username: "real_owner",
        password: "wrong-password",
      });
      expect(response.status).toBe(401);
    }

    const blocked = await attempt(login, "/api/auth/login", {
      username: "real_owner",
      password: "wrong-password",
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe(RATE_LIMITED_MESSAGE);
    expect(body.error).not.toContain("real_owner");

    // Even the correct password is refused while the lockout stands.
    const correct = await attempt(login, "/api/auth/login", {
      username: "real_owner",
      password: "synthetic-password-27",
    });
    expect(correct.status).toBe(429);
  });

  it("answers a missing account exactly as it answers a wrong password", async () => {
    const missing = await attempt(login, "/api/auth/login", {
      username: "missing_owner",
      password: "synthetic-password-27",
    });
    const wrong = await attempt(login, "/api/auth/login", {
      username: "real_owner",
      password: "wrong-password",
    });

    expect(missing.status).toBe(wrong.status);
    expect(await missing.json()).toEqual(await wrong.json());
  });

  it("does not let one username lock out another account", async () => {
    for (let index = 0; index < ACCOUNT_RATE_LIMITS.login.limit; index += 1) {
      await attempt(
        login,
        "/api/auth/login",
        { username: "missing_owner", password: "wrong-password" },
        "203.0.113.9",
      );
    }

    // Same account key is untouched; a different caller still gets in.
    const ok = await attempt(login, "/api/auth/login", {
      username: "real_owner",
      password: "synthetic-password-27",
    });
    expect(ok.status).toBe(200);
    expect(mocks.cookieSet).toHaveBeenCalled();
  });

  it("counts signup attempts too", async () => {
    for (let index = 0; index < ACCOUNT_RATE_LIMITS.signup.limit; index += 1) {
      const response = await attempt(signup, "/api/auth/signup", {
        username: "real_owner",
        password: "synthetic-password-27",
      });
      expect(response.status).toBe(400);
    }

    const blocked = await attempt(signup, "/api/auth/signup", {
      username: "new_owner",
      password: "synthetic-password-27",
    });
    expect(blocked.status).toBe(429);
  });

  it("clears the count when a sign-in succeeds", async () => {
    for (let index = 0; index < ACCOUNT_RATE_LIMITS.login.limit - 1; index += 1) {
      await attempt(login, "/api/auth/login", {
        username: "real_owner",
        password: "wrong-password",
      });
    }

    expect(
      (
        await attempt(login, "/api/auth/login", {
          username: "real_owner",
          password: "synthetic-password-27",
        })
      ).status,
    ).toBe(200);

    // The near-miss run is forgotten, so the next typo is not the last straw.
    expect(
      (
        await attempt(login, "/api/auth/login", {
          username: "real_owner",
          password: "wrong-password",
        })
      ).status,
    ).toBe(401);
  });

  it("resumes authenticator setup after a correct incomplete-account login", async () => {
    const created = await registerAccount(client.db, {
      username: "setup_owner",
      password: "synthetic-password-27",
      completeSignup: false,
    });
    expect(created.ok).toBe(true);

    const response = await attempt(login, "/api/auth/login", {
      username: "setup_owner",
      password: "synthetic-password-27",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/setup-totp" });
  });
});
