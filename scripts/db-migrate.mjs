#!/usr/bin/env node
// `npm run db:migrate` — the only production migration path (D-026).
import { runGuardedMigration } from "./backup/migrate-production.mjs";

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log("usage: npm run db:migrate");
    return 0;
  }
  if (argv.length > 0) {
    // No flags exist on purpose: there is no way to skip the backup.
    console.error(`unexpected argument(s): ${argv.join(" ")}`);
    return 2;
  }

  const result = runGuardedMigration();
  if (!result.applied) {
    console.log("no pending migrations — nothing to apply, no snapshot created");
    return 0;
  }

  console.log(`pending: ${result.pending.map((entry) => entry.tag).join(", ")}`);
  console.log(`backup verified before migration: ${result.backup.directory}`);
  console.log(`migration applied (${result.pending.length})`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`migration refused: ${error.message}`);
  process.exitCode = 1;
}
