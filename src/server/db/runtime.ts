import { resolve } from "node:path";

import { type AppDatabase, type DatabaseClient, openDatabase } from "./client";
import { productionDatabasePath } from "./migrate";

/**
 * One process, one connection (D-038). Nothing here migrates: the guarded
 * command owns that path, so a request can never alter the schema.
 */
const cache = globalThis as unknown as { jobPilotDatabase?: DatabaseClient };

export function resolveDatabasePath(
  configuredPath: string | undefined = process.env.DATABASE_PATH,
): string {
  const configured = configuredPath?.trim();

  return configured && configured.length > 0
    ? resolve(configured)
    : productionDatabasePath();
}

export function getDatabase(): AppDatabase {
  cache.jobPilotDatabase ??= openDatabase(resolveDatabasePath());

  return cache.jobPilotDatabase.db;
}
