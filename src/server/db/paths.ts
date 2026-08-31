import { resolve } from "node:path";

/**
 * Path facts only. Kept apart from the migrator so a request-time module can
 * name the production database without importing migration code at all.
 */
export function productionDatabasePath(appRoot = process.cwd()): string {
  return resolve(appRoot, "var", "job-pilot.sqlite");
}
