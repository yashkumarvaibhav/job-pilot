// The manifest is what makes a snapshot checkable later: what schema it holds,
// how many rows per table, how big the files are, and which document files must
// exist beside it. It never contains a secret — `.env`, `TOKEN_KEY` and every
// API credential stay out of the backup by construction (D-026), because a
// backup carrying its own decryption key is a second copy of the breach.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_FILE = "manifest.json";
export const MANIFEST_VERSION = 1;

export const BACKUP_STATE = {
  preMigration: "pre-migration",
  captured: "captured",
};

export function manifestPath(backupDirectory) {
  return join(backupDirectory, MANIFEST_FILE);
}

export function writeManifest(backupDirectory, manifest) {
  writeFileSync(
    manifestPath(backupDirectory),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export function readManifest(backupDirectory) {
  const manifest = JSON.parse(readFileSync(manifestPath(backupDirectory), "utf8"));
  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    throw new Error(
      `Unsupported manifest version ${manifest.manifestVersion}; this tool writes version ${MANIFEST_VERSION}.`,
    );
  }
  return manifest;
}
