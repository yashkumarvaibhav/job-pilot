import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { verifyPassword } from "../../src/server/auth/password";
import { assertDemoEnvironment } from "./config.mjs";
import { provisionDemo } from "./provision.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixtureEnvironment() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-demo-"));
  scratchRoots.push(root);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    JOB_PILOT_DEPLOYMENT_MODE: "demo",
    DATABASE_PATH: join(root, "var", "demo", "job-pilot.sqlite"),
    UPLOADS_ROOT: join(root, "var", "demo", "uploads"),
    BACKUPS_ROOT: join(root, "var", "demo", "backups"),
    DEMO_ACCOUNT_EMAIL: "demo@jobpilot.invalid.test",
    DEMO_ACCOUNT_PASSWORD: "synthetic-test-password",
  };
  return {
    root,
    env,
  };
}

describe("demo provisioning", () => {
  it("refuses normal storage, mail credentials and an implicit reset", () => {
    const fixture = fixtureEnvironment();
    expect(() =>
      assertDemoEnvironment({
        appRoot: fixture.root,
        env: { ...fixture.env, DATABASE_PATH: join(fixture.root, "var", "job-pilot.sqlite") },
      }),
    ).toThrow("must be a child");
    expect(() =>
      assertDemoEnvironment({
        appRoot: fixture.root,
        env: { ...fixture.env, SMTP_URL: "smtp://mail.invalid.test" },
      }),
    ).toThrow("forbids SMTP_URL");
    expect(() => provisionDemo({ appRoot: fixture.root, env: fixture.env })).toThrow(
      "explicit --reset",
    );
  });

  it("creates one login and only the expected synthetic CRM records", async () => {
    const fixture = fixtureEnvironment();
    const result = provisionDemo({ appRoot: fixture.root, env: fixture.env, reset: true });
    const database = new Database(result.databasePath, { readonly: true });
    try {
      const account = database
        .prepare("select email_normalized, password_hash from user_account")
        .get() as { email_normalized: string; password_hash: string };
      expect(account.email_normalized).toBe("demo@jobpilot.invalid.test");
      expect(
        await verifyPassword(
          fixture.env.DEMO_ACCOUNT_PASSWORD!,
          account.password_hash,
        ),
      ).toBe(true);
      expect(database.prepare("select count(*) from user_account").pluck().get()).toBe(1);
      expect(database.prepare("select count(*) from workspace").pluck().get()).toBe(1);
      expect(database.prepare("select count(*) from company").pluck().get()).toBe(2);
      expect(database.prepare("select count(*) from contact").pluck().get()).toBe(2);
      expect(database.prepare("select count(*) from opportunity").pluck().get()).toBe(2);
      expect(database.prepare("select count(*) from interaction").pluck().get()).toBe(1);
      expect(
        database.prepare("select count(*) from contact_method where value like '%invalid.test'").pluck().get(),
      ).toBe(1);
      expect(database.pragma("integrity_check", { simple: true })).toBe("ok");
    } finally {
      database.close();
    }
  });

  it("resets prior sessions and restores the stable dataset", () => {
    const fixture = fixtureEnvironment();
    const first = provisionDemo({ appRoot: fixture.root, env: fixture.env, reset: true });
    const database = new Database(first.databasePath);
    database.prepare(
      `insert into auth_session
        (id, user_id, token_digest, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       values ('stale-session', 'demo-user', 'stale-token', 1, 1, 2, 3)`,
    ).run();
    database.close();

    const second = provisionDemo({ appRoot: fixture.root, env: fixture.env, reset: true });
    const reloaded = new Database(second.databasePath, { readonly: true });
    try {
      expect(reloaded.prepare("select count(*) from auth_session").pluck().get()).toBe(0);
      expect(reloaded.prepare("select count(*) from company").pluck().get()).toBe(2);
    } finally {
      reloaded.close();
    }
  });
});
