// Path facts for the operational tools (backup, restore, guarded migration).
//
// These run as plain ESM under `node`, with no build step and no TypeScript
// loader, because `npm run db:migrate` has to work in production after
// `npm ci --omit=dev` — where no dev toolchain exists.
import { resolve } from "node:path";

export const DEFAULT_DATABASE_PATH = "./var/job-pilot.sqlite";
export const DEFAULT_BACKUPS_DIRECTORY = "./var/backups";
export const DEFAULT_UPLOADS_DIRECTORY = "./var/uploads";

function resolvedRelative(root, configured, fallback) {
  const trimmed = typeof configured === "string" ? configured.trim() : "";
  return resolve(root, trimmed.length > 0 ? trimmed : fallback);
}

/**
 * Resolve every path the tools touch, relative to the application root.
 * Deployment-specific roots are explicit env overrides so a synthetic demo
 * cannot share mutable storage with a private workspace deployment.
 */
export function resolveBackupPaths(options = {}) {
  const { appRoot = process.cwd(), env = process.env } = options;
  const root = resolve(appRoot);

  return {
    appRoot: root,
    databasePath: resolvedRelative(
      root,
      options.databasePath ?? env.DATABASE_PATH,
      DEFAULT_DATABASE_PATH,
    ),
    backupsRoot: resolvedRelative(
      root,
      options.backupsRoot ?? env.BACKUPS_ROOT,
      DEFAULT_BACKUPS_DIRECTORY,
    ),
    uploadsRoot: resolvedRelative(
      root,
      options.uploadsRoot ?? env.UPLOADS_ROOT,
      DEFAULT_UPLOADS_DIRECTORY,
    ),
  };
}
