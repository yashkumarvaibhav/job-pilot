// The production migration command.
//
// D-026 puts the destructive boundary here rather than at every service start:
// an ordinary restart must not depend on backup health, but a schema change
// must never happen without a snapshot standing behind it. So this command
// looks first, and only the pending case takes a backup — which must pass its
// own full verification before a single statement is applied.
//
// There is deliberately no environment bypass and no reusable recent-snapshot
// window: the backup that stands behind a migration is the one taken for it.
import { createBackup } from "./backup.mjs";
import {
  applyMigrations,
  pendingMigrationsFor,
  resolveMigrationsFolder,
} from "./migrations.mjs";
import { resolveBackupPaths } from "./paths.mjs";

export function runGuardedMigration(options = {}) {
  const paths = resolveBackupPaths(options);
  const migrationsFolder = resolveMigrationsFolder(
    paths.appRoot,
    options.migrationsFolder,
  );
  const pending = pendingMigrationsFor(paths.databasePath, migrationsFolder);

  if (pending.length === 0) {
    return { pending: [], backup: null, applied: false };
  }

  // Throws if the snapshot cannot be taken or cannot be verified, and the
  // migration never runs. That is the whole point of the guard.
  const backup = (options.createBackup ?? createBackup)({
    ...options,
    migrationsFolder,
  });

  applyMigrations(paths.databasePath, migrationsFolder);

  return { pending, backup, applied: true };
}
