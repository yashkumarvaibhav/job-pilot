#!/usr/bin/env node
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import Database from "better-sqlite3";

function requiredReset(reset) {
  if (!reset) {
    throw new Error("Walkthrough reset requires the explicit --reset flag.");
  }
}

export function isSyntheticAccountEmail(email) {
  const domain = String(email ?? "").split("@")[1] ?? "";
  return domain === "invalid.test" || domain.endsWith(".invalid.test");
}

function isInside(candidate, directory) {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === "" ||
    !(
      pathFromDirectory === ".." ||
      pathFromDirectory.startsWith(`..${sep}`) ||
      isAbsolute(pathFromDirectory)
    )
  );
}

export function assertWalkthroughResetEnvironment({
  appRoot = process.cwd(),
  env = process.env,
} = {}) {
  if (env.NODE_ENV === "production") {
    throw new Error("Walkthrough reset refuses NODE_ENV=production.");
  }
  if (env.JOB_PILOT_DEPLOYMENT_MODE?.trim() === "demo") {
    throw new Error("Walkthrough reset refuses demo mode.");
  }

  const root = resolve(appRoot);
  const demoRoot = resolve(root, "var", "demo");
  const configured = env.DATABASE_PATH?.trim();
  const databasePath = configured
    ? isAbsolute(configured)
      ? resolve(configured)
      : resolve(root, configured)
    : resolve(root, "var", "job-pilot.sqlite");

  if (isInside(databasePath, demoRoot)) {
    throw new Error("Walkthrough reset refuses public/demo storage.");
  }

  return { appRoot: root, databasePath };
}

export function resetSyntheticWalkthroughRows({
  appRoot = process.cwd(),
  env = process.env,
  reset = false,
} = {}) {
  requiredReset(reset);
  const configuration = assertWalkthroughResetEnvironment({ appRoot, env });
  if (!existsSync(configuration.databasePath)) {
    throw new Error(
      `No development database at ${configuration.databasePath}.`,
    );
  }

  const sqlite = new Database(configuration.databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const accounts = sqlite
      .prepare("select id, username_normalized from user_account")
      .all();
    const synthetic = accounts.filter((account) =>
      isSyntheticAccountEmail(account.username_normalized),
    );
    const remove = sqlite.prepare("delete from user_account where id = ?");
    sqlite.transaction(() => {
      for (const account of synthetic) {
        remove.run(account.id);
      }
    })();

    return {
      databasePath: configuration.databasePath,
      removedAccounts: synthetic.length,
    };
  } finally {
    sqlite.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = resetSyntheticWalkthroughRows({
      reset: process.argv.slice(2).includes("--reset"),
    });
    console.log(
      `removed ${result.removedAccounts} synthetic account(s) from ${result.databasePath}`,
    );
  } catch (error) {
    console.error(
      `walkthrough reset refused: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}
