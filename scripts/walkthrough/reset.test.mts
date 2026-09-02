import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAccountFoundation } from "../../src/server/db/foundation";
import { migrateDatabase } from "../../src/server/db/migrate";
import { openDatabase } from "../../src/server/db/client";
import { createCompany } from "../../src/server/repos/companies";
import {
  assertWalkthroughResetEnvironment,
  isSyntheticAccountEmail,
  resetSyntheticWalkthroughRows,
} from "./reset.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-walkthrough-"));
  scratchRoots.push(root);
  return root;
}

describe("walkthrough reset", () => {
  it("classifies only non-deliverable invalid.test addresses as synthetic", () => {
    expect(isSyntheticAccountEmail("p01-a@invalid.test")).toBe(true);
    expect(isSyntheticAccountEmail("demo@jobpilot.invalid.test")).toBe(true);
    expect(isSyntheticAccountEmail("owner@example.com")).toBe(false);
  });

  it("refuses production, demo mode, public storage and an implicit reset", () => {
    const root = scratchRoot();
    const localPath = join(root, "var", "job-pilot.sqlite");
    const demoPath = join(root, "var", "demo", "job-pilot.sqlite");

    expect(() =>
      assertWalkthroughResetEnvironment({
        appRoot: root,
        env: { NODE_ENV: "production", DATABASE_PATH: localPath },
      }),
    ).toThrow("NODE_ENV=production");
    expect(() =>
      assertWalkthroughResetEnvironment({
        appRoot: root,
        env: {
          NODE_ENV: "test",
          JOB_PILOT_DEPLOYMENT_MODE: "demo",
          DATABASE_PATH: localPath,
        },
      }),
    ).toThrow("demo mode");
    expect(() =>
      assertWalkthroughResetEnvironment({
        appRoot: root,
        env: { NODE_ENV: "test", DATABASE_PATH: demoPath },
      }),
    ).toThrow("public/demo storage");
    expect(() =>
      resetSyntheticWalkthroughRows({
        appRoot: root,
        env: { NODE_ENV: "test", DATABASE_PATH: localPath },
      }),
    ).toThrow("explicit --reset");
  });

  it("deletes synthetic accounts and leaves a non-synthetic workspace intact", () => {
    const root = scratchRoot();
    const databasePath = join(root, "var", "job-pilot.sqlite");
    migrateDatabase(databasePath);
    const client = openDatabase(databasePath);
    try {
      const walkthrough = createAccountFoundation(client.db, {
        emailNormalized: "p01-a@invalid.test",
        passwordHash: "synthetic-hash-a",
        displayName: "Walkthrough A",
      }).tenant;
      const owner = createAccountFoundation(client.db, {
        emailNormalized: "owner@example.com",
        passwordHash: "owner-hash",
        displayName: "Owner",
      }).tenant;
      createCompany(client.db, walkthrough, { name: "Microsoft" });
      createCompany(client.db, owner, { name: "Keep Me" });
    } finally {
      client.close();
    }

    const result = resetSyntheticWalkthroughRows({
      appRoot: root,
      env: { NODE_ENV: "test", DATABASE_PATH: databasePath },
      reset: true,
    });
    expect(result.removedAccounts).toBe(1);

    const verify = openDatabase(databasePath);
    try {
      const emails = verify.sqlite
        .prepare("select email_normalized from user_account")
        .all() as { email_normalized: string }[];
      expect(emails.map((row) => row.email_normalized)).toEqual([
        "owner@example.com",
      ]);
      expect(
        verify.sqlite.prepare("select name from company").all(),
      ).toEqual([{ name: "Keep Me" }]);
    } finally {
      verify.close();
    }
  });
});
