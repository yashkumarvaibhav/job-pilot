import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDatabase } from "./client";

export type MigrationOptions = {
  migrationsFolder?: string;
};

export function productionDatabasePath(appRoot = process.cwd()): string {
  return resolve(appRoot, "var", "job-pilot.sqlite");
}

export function migrateDatabase(
  databasePath: string,
  options: MigrationOptions = {},
): void {
  if (databasePath.trim().length === 0) {
    throw new Error("An explicit SQLite database path is required.");
  }

  const resolvedDatabasePath = resolve(databasePath);
  const migrationsFolder = resolve(
    options.migrationsFolder ?? resolve(process.cwd(), "drizzle"),
  );
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });

  const client = openDatabase(resolvedDatabasePath);
  try {
    migrate(client.db, { migrationsFolder });
  } finally {
    client.close();
  }
}
