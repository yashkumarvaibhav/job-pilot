#!/usr/bin/env node
// `bin/backup` — take a verified snapshot of the database and its uploads.
import { createBackup } from "./backup/backup.mjs";
import { pruneBackups } from "./backup/prune.mjs";

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

function reportPrune(result) {
  console.log(
    `kept ${result.kept.length} generation(s), removed ${result.removed.length}`,
  );
  for (const name of result.removed) {
    console.log(`  removed ${name}`);
  }
  if (result.unknown.length > 0) {
    console.log(
      `left alone (not a backup this tool made): ${result.unknown.join(", ")}`,
    );
  }
  const megabytes = (result.bytes / (1024 * 1024)).toFixed(1);
  console.log(`retained: ${megabytes} MB of a ${result.budgetMb} MB budget`);
  if (result.overBudget) {
    // Pruning has already happened; this is the loud part, not a refusal.
    console.error(
      `backups exceed BACKUP_BUDGET_MB (${megabytes} MB > ${result.budgetMb} MB) after pruning`,
    );
    return 1;
  }
  return 0;
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: bin/backup            take a verified snapshot");
    console.log("       bin/backup --prune    remove expired generations, then measure");
    return 0;
  }
  if (argv.length === 1 && argv[0] === "--prune") {
    return reportPrune(pruneBackups());
  }
  const unknown = argv.filter((argument) => argument.startsWith("-"));
  if (unknown.length > 0) {
    console.error(`unknown option(s): ${unknown.join(" ")}`);
    return 2;
  }
  if (argv.length > 0) {
    console.error(`unexpected argument(s): ${argv.join(" ")}`);
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
