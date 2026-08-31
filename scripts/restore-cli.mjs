#!/usr/bin/env node
// `bin/restore` — restore a backup and prove it, table by table.
import { resolve } from "node:path";

import { restoreBackup } from "./backup/restore.mjs";

// bin/restore changes directory into the application root, so paths the
// operator typed are resolved against where they actually stood.
const invokedFrom = process.env.JOB_PILOT_INVOKED_FROM ?? process.cwd();

const USAGE =
  "usage: bin/restore <backup-directory> --into <path>\n" +
  "       bin/restore <backup-directory> --force        (overwrites the live database)";

export function parseRestoreArguments(argv) {
  const options = { directory: undefined, into: undefined, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") {
      options.force = true;
    } else if (argument === "--into") {
      index += 1;
      options.into = argv[index];
      if (options.into === undefined) {
        throw new Error("--into needs a path.");
      }
    } else if (argument.startsWith("--into=")) {
      options.into = argument.slice("--into=".length);
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option: ${argument}`);
    } else if (options.directory === undefined) {
      options.directory = argument;
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }
  if (options.into !== undefined && options.into.trim() === "") {
    throw new Error("--into needs a path.");
  }
  return options;
}

function reportRestore(result) {
  console.log(`restored: ${result.target}`);
  console.log("integrity_check: ok");
  console.log("foreign_key_check: ok");
  const width = Math.max(5, ...result.counts.map((row) => row.table.length));
  console.log(`${"table".padEnd(width)}  manifest  restored`);
  for (const row of result.counts) {
    console.log(
      `${row.table.padEnd(width)}  ${String(row.manifest).padStart(8)}  ${String(
        row.restored,
      ).padStart(8)}`,
    );
  }
  console.log(`documents: ${result.documents.verified} verified by sha256`);
  if (result.live) {
    console.log(`uploads restored: ${result.uploads.restored} file(s)`);
    console.log(
      `revoked: ${result.revoked.sessions} session(s), ${result.revoked.accountTokens} unused account token(s)`,
    );
  }
}

function main(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return argv.length === 0 ? 2 : 0;
  }
  const options = parseRestoreArguments(argv);
  if (options.directory === undefined) {
    console.error(`a backup directory is required.\n${USAGE}`);
    return 2;
  }
  reportRestore(
    restoreBackup({
      ...options,
      directory: resolve(invokedFrom, options.directory),
      into: options.into === undefined ? undefined : resolve(invokedFrom, options.into),
    }),
  );
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`restore failed: ${error.message}`);
  process.exitCode = 1;
}
