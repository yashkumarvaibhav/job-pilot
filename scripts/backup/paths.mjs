// Path facts for the operational tools (backup, restore, guarded migration).
//
// These run as plain ESM under `node`, with no build step and no TypeScript
// loader, because `npm run db:migrate` has to work in production after
// `npm ci --omit=dev` — where no dev toolchain exists.
import { resolve } from "node:path";

export const DEFAULT_DATABASE_PATH = "./var/job-pilot.sqlite";
export const DEFAULT_BACKUPS_DIRECTORY = "./var/backups";
export const DEFAULT_UPLOADS_DIRECTORY = "./var/uploads";

/**
 * Resolve every path the tools touch, relative to the application root.
 * `DATABASE_PATH` is the one env override the app itself already honours.
 */
export function resolveBackupPaths(options = {}) {
  const { appRoot = process.cwd(), env = process.env } = options;
  const root = resolve(appRoot);
  const databasePath = resolve(
    root,
    options.databasePath ?? env.DATABASE_PATH?.trim() ?? DEFAULT_DATABASE_PATH,
  );

  return {
    appRoot: root,
    databasePath,
    backupsRoot: resolve(root, options.backupsRoot ?? DEFAULT_BACKUPS_DIRECTORY),
    uploadsRoot: resolve(root, options.uploadsRoot ?? DEFAULT_UPLOADS_DIRECTORY),
  };
}
