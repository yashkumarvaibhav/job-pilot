// Restoring, and proving the restore.
//
// A backup nobody has restored is a hope, not a backup. Restore therefore
// always verifies: integrity, foreign keys, every per-table count against the
// manifest, and every document reference against the backed-up files by hash.
// Row counts alone would happily pass a backup whose documents are all missing.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { SNAPSHOT_UPLOADS_DIRECTORY } from "./backup.mjs";
import {
  readDocumentEntries,
  sha256File,
  verifyDocumentEntries,
} from "./documents.mjs";
import { BACKUP_STATE, readManifest } from "./manifest.mjs";
import { resolveBackupPaths } from "./paths.mjs";
import { countAllTables, openReadable } from "./sqlite.mjs";

class RestoreError extends Error {}

export function restoreBackup(options = {}) {
  const paths = resolveBackupPaths(options);
  const directory = resolve(paths.appRoot, options.directory ?? "");
  if (options.directory === undefined || options.directory === "") {
    throw new RestoreError("A backup directory is required.");
  }
  if (!existsSync(directory)) {
    throw new RestoreError(`No backup directory at ${directory}.`);
  }

  const manifest = readManifest(directory);
  if (manifest.state !== BACKUP_STATE.captured) {
    throw new RestoreError(
      `This backup is '${manifest.state}', not '${BACKUP_STATE.captured}'. ` +
        "Only a captured backup can be restored.",
    );
  }

  const target = resolve(paths.appRoot, options.into ?? paths.databasePath);
  const live = target === paths.databasePath;
  if (live && options.force !== true) {
    throw new RestoreError(
      `Refusing to overwrite the live database at ${target}. ` +
        "Restore somewhere else with --into <path>, or pass --force if you mean it.",
    );
  }

  const snapshotPath = join(directory, manifest.snapshot.file);
  if (!existsSync(snapshotPath)) {
    throw new RestoreError(`The snapshot ${snapshotPath} is missing.`);
  }
  if (resolve(snapshotPath) === target) {
    throw new RestoreError("Refusing to restore a snapshot over itself.");
  }

  mkdirSync(dirname(target), { recursive: true });
  // A stale sidecar beside the target would be replayed onto a database it does
  // not belong to, which is a corrupt database wearing a restored one's name.
  for (const sidecar of [`${target}-wal`, `${target}-shm`]) {
    rmSync(sidecar, { force: true });
  }
  copyFileSync(snapshotPath, target);

  const restored = openReadable(target);
  let counts;
  let documents;
  try {
    const integrity = restored.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new RestoreError(`integrity_check failed: ${integrity}`);
    }
    const foreignKeyProblems = restored.pragma("foreign_key_check");
    if (foreignKeyProblems.length > 0) {
      throw new RestoreError(
        `foreign_key_check failed: ${JSON.stringify(foreignKeyProblems)}`,
      );
    }

    counts = compareCounts(manifest, countAllTables(restored));
    documents = readDocumentEntries(restored);
  } finally {
    restored.close();
  }

  const backedUpUploads = join(directory, SNAPSHOT_UPLOADS_DIRECTORY);
  const { problems } = verifyDocumentEntries(documents.entries, backedUpUploads);
  if (problems.length > 0) {
    throw new RestoreError(
      `Restored database references files this backup does not hold:\n  ${problems.join("\n  ")}`,
    );
  }

  const result = {
    target,
    live,
    manifest,
    counts,
    documents: { verified: documents.entries.length },
    uploads: { restored: 0 },
    revoked: { sessions: 0, accountTokens: 0 },
  };

  if (live) {
    // Only a live restore mutates anything. A scratch verification must leave
    // the copy byte-identical to the snapshot, or the counts it just proved
    // would no longer describe what is on disk.
    result.uploads.restored = restoreUploads(backedUpUploads, paths.uploadsRoot);
    result.revoked = revokeRestoredCredentials(target, options.now ?? new Date());
  }

  return result;
}

function compareCounts(manifest, actual) {
  const expected = manifest.tables ?? {};
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const rows = names.map((table) => ({
    table,
    manifest: expected[table] ?? null,
    restored: actual[table] ?? null,
  }));
  const mismatches = rows.filter((row) => row.manifest !== row.restored);
  if (mismatches.length > 0) {
    throw new RestoreError(
      `Restored row counts do not match the manifest:\n  ${mismatches
        .map((row) => `${row.table}: manifest ${row.manifest}, restored ${row.restored}`)
        .join("\n  ")}`,
    );
  }
  return rows;
}

/**
 * Put the backed-up files back beside the restored database. Missing and
 * differing files are written; files the backup does not know about are left
 * alone, because deleting an operator's data is not part of a restore.
 */
function restoreUploads(backedUpUploads, uploadsRoot) {
  if (!existsSync(backedUpUploads)) {
    return 0;
  }
  let copied = 0;
  for (const entry of readdirSync(backedUpUploads, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) {
      continue;
    }
    const source = join(entry.parentPath, entry.name);
    const relativePath = source.slice(backedUpUploads.length + 1);
    const destination = join(uploadsRoot, relativePath);
    if (
      existsSync(destination) &&
      statSync(destination).size === statSync(source).size &&
      sha256File(destination) === sha256File(source)
    ) {
      continue;
    }
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    copied += 1;
  }
  return copied;
}

/**
 * A restored database carries the sessions and account tokens that were live
 * when the snapshot was taken. Serving traffic with them would silently
 * resurrect a signed-out browser's cookie and any reset link still in an inbox.
 */
function revokeRestoredCredentials(databasePath, now) {
  const database = openReadable(databasePath);
  try {
    const sessions = database
      .prepare("update auth_session set revoked_at = ? where revoked_at is null")
      .run(now.getTime()).changes;
    const accountTokens = database
      .prepare("delete from account_token where used_at is null")
      .run().changes;
    return { sessions, accountTokens };
  } finally {
    database.close();
  }
}
