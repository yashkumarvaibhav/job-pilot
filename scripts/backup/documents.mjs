// Document pairing: a snapshot of the database plus a copy of the uploads
// directory is only a backup if every row still points at a file that is
// actually there and still hashes to what the row claims.
//
// `document_version` does not exist until JP-0023. Before then a backup records
// an empty document map; the moment the table appears, verification turns on by
// itself. The three columns below are the contract that task must satisfy:
//   id           — the version id recorded in the manifest
//   storage_key  — path of the stored file, relative to the uploads directory
//   sha256       — lowercase hex digest of that file's bytes
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";

import { tableExists } from "./sqlite.mjs";

export const DOCUMENT_TABLE = "document_version";
export const DOCUMENT_COLUMNS = ["id", "storage_key", "sha256"];

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Read the document rows out of a database. Returns `present: false` before
 * JP-0023 creates the table — that is a valid backup, not a failure.
 */
export function readDocumentEntries(database) {
  if (!tableExists(database, DOCUMENT_TABLE)) {
    return { present: false, entries: [] };
  }

  const columns = database
    .prepare(`select name from pragma_table_info('${DOCUMENT_TABLE}')`)
    .all()
    .map((row) => row.name);
  const missing = DOCUMENT_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `${DOCUMENT_TABLE} is missing the column(s) ${missing.join(", ")} that backup verification requires. ` +
        `The backup contract is (${DOCUMENT_COLUMNS.join(", ")}).`,
    );
  }

  const entries = database
    .prepare(
      `select id, storage_key as storageKey, sha256 from ${DOCUMENT_TABLE} order by id`,
    )
    .all();

  return { present: true, entries };
}

/** A stored key must stay inside the uploads directory. */
function resolveStoredFile(uploadsDirectory, storageKey) {
  if (typeof storageKey !== "string" || storageKey.trim().length === 0) {
    return { ok: false, reason: "blank storage_key" };
  }
  if (isAbsolute(storageKey)) {
    return { ok: false, reason: "absolute storage_key" };
  }
  const normalized = normalize(storageKey);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    return { ok: false, reason: "storage_key escapes the uploads directory" };
  }
  return { ok: true, path: join(uploadsDirectory, normalized) };
}

/**
 * Check every entry against the files as copied. Returns the verified map for
 * the manifest and the list of problems; callers decide how loudly to fail,
 * but every caller in this codebase fails.
 */
export function verifyDocumentEntries(entries, uploadsDirectory) {
  const verified = {};
  const problems = [];

  for (const entry of entries) {
    const resolved = resolveStoredFile(uploadsDirectory, entry.storageKey);
    if (!resolved.ok) {
      problems.push(`${entry.id}: ${resolved.reason}`);
      continue;
    }
    if (!existsSync(resolved.path)) {
      problems.push(`${entry.id}: file missing (${entry.storageKey})`);
      continue;
    }
    const actual = sha256File(resolved.path);
    if (actual !== entry.sha256) {
      problems.push(
        `${entry.id}: sha256 mismatch (${entry.storageKey}) — row ${entry.sha256}, file ${actual}`,
      );
      continue;
    }
    verified[entry.id] = {
      storageKey: entry.storageKey,
      sha256: entry.sha256,
      bytes: statSync(resolved.path).size,
    };
  }

  return { verified, problems };
}
