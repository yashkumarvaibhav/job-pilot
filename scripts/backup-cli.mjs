#!/usr/bin/env node
// `bin/backup` — take a verified snapshot of the database and its uploads.
import { createBackup } from "./backup/backup.mjs";

function reportBackup(result) {
  console.log(result.directory);
  console.log(`state: ${result.state}`);
  if (result.state === "pre-migration") {
    console.log(
      "no user tables yet — recorded an empty manifest and left the database alone",
    );
    return;
  }
  const tables = Object.entries(result.manifest.tables);
  const rows = tables.reduce((total, [, count]) => total + count, 0);
  console.log(`tables: ${tables.length}, rows: ${rows}`);
  console.log(
    result.manifest.documents.table === "absent"
      ? "documents: none (document_version does not exist yet)"
      : `documents: ${result.manifest.documents.count} verified by sha256`,
  );
  console.log(
    `uploads: ${result.manifest.uploads.fileCount} file(s), ${result.manifest.uploads.bytes} bytes`,
  );
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: bin/backup");
    return 0;
  }
  const unknown = argv.filter((argument) => argument.startsWith("-"));
  if (unknown.length > 0) {
    console.error(`unknown option(s): ${unknown.join(" ")}`);
    return 2;
  }

  reportBackup(createBackup());
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`backup failed: ${error.message}`);
  process.exitCode = 1;
}
