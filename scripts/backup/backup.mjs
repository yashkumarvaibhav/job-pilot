// Taking a backup.
//
// Never `cp` a live SQLite database: a file copied mid-transaction can be
// corrupt, and the `-wal` sidecar holds committed pages the main file does not.
// `VACUUM INTO` writes one consistent file with no sidecars while the service
// keeps serving. Uploads are copied *after* the snapshot and then checked
// against it, because a consistent database is not a consistent
// database-plus-files.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";

import { readDocumentEntries, verifyDocumentEntries } from "./documents.mjs";
import { BACKUP_STATE, MANIFEST_VERSION, writeManifest } from "./manifest.mjs";
import { resolveMigrationsFolder, schemaStamp } from "./migrations.mjs";
import { resolveBackupPaths } from "./paths.mjs";
import { countAllTables, listUserTables, openReadable } from "./sqlite.mjs";

export const SNAPSHOT_UPLOADS_DIRECTORY = "uploads";

/** `2026-08-31T21:45:07.123Z` -> `20260831T214507Z`: sortable and portable. */
export function backupStamp(date = new Date()) {
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
}

/** Two backups in the same second get distinct directories rather than one merged one. */
export function allocateBackupDirectory(backupsRoot, stamp) {
  mkdirSync(backupsRoot, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const directory = join(backupsRoot, attempt === 0 ? stamp : `${stamp}-${attempt}`);
    try {
      mkdirSync(directory);
      return directory;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(`Could not allocate a backup directory under ${backupsRoot}.`);
}

function measureDirectory(directory) {
  let fileCount = 0;
  let bytes = 0;
  if (!existsSync(directory)) {
    return { fileCount, bytes };
  }
  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      fileCount += 1;
      bytes += statSync(join(entry.parentPath ?? entry.path, entry.name)).size;
    }
  }
  return { fileCount, bytes };
}

/**
 * First boot is defined, not assumed: no database file, or one with no user
 * tables, means there is nothing to protect yet. That case has to exit 0 —
 * a startup gate that blocks the first startup is not a safety feature.
 */
export function isPreMigrationDatabase(databasePath) {
  if (!existsSync(databasePath)) {
    return true;
  }
  const database = openReadable(databasePath);
  try {
    return listUserTables(database).length === 0;
  } finally {
    database.close();
  }
}

export function createBackup(options = {}) {
  const paths = resolveBackupPaths(options);
  const migrationsFolder = resolveMigrationsFolder(
    paths.appRoot,
    options.migrationsFolder,
  );
  const now = options.now ?? new Date();
  const directory = allocateBackupDirectory(
    paths.backupsRoot,
    backupStamp(now),
  );

  const common = {
    manifestVersion: MANIFEST_VERSION,
    createdAt: now.toISOString(),
    source: {
      database: paths.databasePath,
      uploads: paths.uploadsRoot,
    },
  };

  if (isPreMigrationDatabase(paths.databasePath)) {
    const manifest = writeManifest(directory, {
      ...common,
      state: BACKUP_STATE.preMigration,
      snapshot: null,
      schema: { appliedMigrations: 0, latestMigrationAt: null, latestTag: null },
      tables: {},
      documents: { table: "absent", count: 0, entries: {} },
      uploads: { copied: false, fileCount: 0, bytes: 0 },
    });
    return { state: manifest.state, directory, manifest };
  }

  const snapshotName = basename(paths.databasePath);
  const snapshotPath = join(directory, snapshotName);

  const source = openReadable(paths.databasePath);
  try {
    // Bound parameter, so a path containing a quote cannot break out.
    source.prepare("vacuum into ?").run(snapshotPath);
  } finally {
    source.close();
  }

  const snapshotUploads = join(directory, SNAPSHOT_UPLOADS_DIRECTORY);
  if (existsSync(paths.uploadsRoot)) {
    cpSync(paths.uploadsRoot, snapshotUploads, { recursive: true });
  } else {
    mkdirSync(snapshotUploads, { recursive: true });
  }

  const snapshot = openReadable(snapshotPath);
  let documents;
  let tables;
  let schema;
  try {
    schema = schemaStamp(snapshot, migrationsFolder);
    tables = countAllTables(snapshot);
    documents = readDocumentEntries(snapshot);
  } finally {
    snapshot.close();
  }

  const { verified, problems } = verifyDocumentEntries(
    documents.entries,
    snapshotUploads,
  );

  const manifest = writeManifest(directory, {
    ...common,
    state: problems.length === 0 ? BACKUP_STATE.captured : "failed",
    snapshot: { file: snapshotName, bytes: statSync(snapshotPath).size },
    schema,
    tables,
    documents: {
      table: documents.present ? "present" : "absent",
      count: documents.entries.length,
      entries: verified,
    },
    uploads: { copied: true, ...measureDirectory(snapshotUploads) },
    ...(problems.length === 0 ? {} : { problems }),
  });

  if (problems.length > 0) {
    // The directory stays, marked `failed`, so the evidence survives and no
    // later run can mistake it for a snapshot worth restoring.
    throw new Error(
      `Backup failed document verification (${directory}):\n  ${problems.join("\n  ")}`,
    );
  }

  return { state: manifest.state, directory, manifest };
}

/** Used by the tests and the self-test to clean up a scratch backups tree. */
export function removeBackupDirectory(directory) {
  rmSync(directory, { force: true, recursive: true });
}
