import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAccount } from "@/server/auth/accounts";
import { resolveEnrollmentSessionTenant, startSession } from "@/server/auth/session";
import { openDatabase, type DatabaseClient } from "@/server/db/client";
import { migrateDatabase } from "@/server/db/migrate";
import type { TenantContext } from "@/server/db/tenant";

const mocks = vi.hoisted(() => ({
  database: undefined as unknown,
  tenant: null as TenantContext | null,
  endSession: vi.fn(),
}));

vi.mock("@/server/db/runtime", () => ({
  getDatabase: () => mocks.database,
}));
vi.mock("@/server/auth/current-session", () => ({
  currentIncompleteSignupTenant: async () => mocks.tenant,
  endSession: mocks.endSession,
}));

import { POST as abandonSignup } from "./route";

const PASSWORD = "synthetic-owner-password";

describe("POST /api/auth/signup/abandon", () => {
  let client: DatabaseClient;
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "job-pilot-abandon-signup-route-"));
    const databasePath = join(directory, "test.sqlite");
    migrateDatabase(databasePath);
    client = openDatabase(databasePath);
    mocks.database = client.db;
    mocks.tenant = null;
    mocks.endSession.mockReset();
  });

  afterEach(() => {
    client.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it("requires setup-purpose authority", async () => {
    const response = await abandonSignup();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Incomplete signup required." });
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it("does not delete an account whose signup is complete", async () => {
    const created = await registerAccount(client.db, {
      username: "completed_owner",
      password: PASSWORD,
    });
    if (!created.ok) throw new Error("fixture account was not created");
    mocks.tenant = created.tenant;

    const response = await abandonSignup();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Incomplete signup required." });
    expect(
      client.sqlite
        .prepare("select count(*) as count from user_account where id = ?")
        .get(created.tenant.userId),
    ).toEqual({ count: 1 });
    expect(mocks.endSession).not.toHaveBeenCalled();
  });

  it("deletes only the current incomplete account and frees its username", async () => {
    const current = await registerAccount(client.db, {
      username: "unfinished_owner",
      password: PASSWORD,
      completeSignup: false,
    });
    const other = await registerAccount(client.db, {
      username: "other_unfinished_owner",
      password: PASSWORD,
      completeSignup: false,
    });
    if (!current.ok || !other.ok) throw new Error("fixture accounts were not created");
    const currentSession = startSession(client.db, current.tenant.userId);
    const otherSession = startSession(client.db, other.tenant.userId);
    mocks.tenant = current.tenant;

    const response = await abandonSignup();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, redirect: "/" });
    expect(mocks.endSession).toHaveBeenCalledOnce();
    expect(resolveEnrollmentSessionTenant(client.db, currentSession.token)).toBeNull();
    expect(resolveEnrollmentSessionTenant(client.db, otherSession.token)).toEqual(
      other.tenant,
    );
    expect(
      client.sqlite
        .prepare("select count(*) as count from workspace where owner_user_id = ?")
        .get(current.tenant.userId),
    ).toEqual({ count: 0 });
    expect(
      client.sqlite
        .prepare("select count(*) as count from user_account where id = ?")
        .get(other.tenant.userId),
    ).toEqual({ count: 1 });

    const reused = await registerAccount(client.db, {
      username: "unfinished_owner",
      password: PASSWORD,
      completeSignup: false,
    });
    expect(reused.ok).toBe(true);
  });
});
