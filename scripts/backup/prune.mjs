// Retention.
//
// "Keep one a month forever" is a disk-usage bug with a slow fuse, so the
// monthly generations are capped too. Pruning always runs before measuring:
// an over-budget backups directory must never block the very operation that
// recovers the space.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { resolveBackupPaths } from "./paths.mjs";

export const DAILY_GENERATIONS = 14;
export const MONTHLY_GENERATIONS = 12;
export const DEFAULT_BUDGET_MB = 2048;

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{6})Z(-\d+)?$/;

/**
 * Decide what to keep from a list of generation directory names.
 * Pure, so the rule can be tested without creating 40 backups.
 *
 * @returns {{ keep: string[], remove: string[], unknown: string[] }}
 */
export function planRetention(names, options = {}) {
  const dailies = options.dailies ?? DAILY_GENERATIONS;
  const monthlies = options.monthlies ?? MONTHLY_GENERATIONS;

  const unknown = names.filter((name) => !STAMP.test(name)).sort();
  // Newest first. The stamp is fixed-width, so lexical order is time order.
  const generations = names.filter((name) => STAMP.test(name)).sort().reverse();

  const keep = new Set(generations.slice(0, dailies));

  // Walking newest first, the first generation seen in a month is that month's
  // last snapshot. A month the daily window already covers costs no monthly
  // slot, so the ceiling really is 14 dailies plus 12 monthlies.
  const monthsSeen = new Set();
  let monthlyGenerations = 0;
  for (const name of generations) {
    const month = name.slice(0, 6);
    if (monthsSeen.has(month)) {
      continue;
    }
    monthsSeen.add(month);
    if (keep.has(name)) {
      continue;
    }
    if (monthlyGenerations >= monthlies) {
      break;
    }
    keep.add(name);
    monthlyGenerations += 1;
  }

  return {
    keep: [...keep].sort(),
    remove: generations.filter((name) => !keep.has(name)).sort(),
    unknown,
  };
}

function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of readdirSync(directory, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      bytes += statSync(join(entry.parentPath, entry.name)).size;
    }
  }
  return bytes;
}

export function pruneBackups(options = {}) {
  const paths = resolveBackupPaths(options);
  const env = options.env ?? process.env;
  const budgetMb = Number(options.budgetMb ?? env.BACKUP_BUDGET_MB ?? DEFAULT_BUDGET_MB);
  if (!Number.isFinite(budgetMb) || budgetMb < 0) {
    throw new Error(`BACKUP_BUDGET_MB must be a non-negative number, not '${env.BACKUP_BUDGET_MB}'.`);
  }

  if (!existsSync(paths.backupsRoot)) {
    return { kept: [], removed: [], unknown: [], bytes: 0, budgetMb, overBudget: false };
  }

  const names = readdirSync(paths.backupsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const plan = planRetention(names, options);

  for (const name of plan.remove) {
    rmSync(join(paths.backupsRoot, name), { force: true, recursive: true });
  }

  // Measure only after the removals, and only what is actually retained.
  const bytes = [...plan.keep, ...plan.unknown].reduce(
    (total, name) => total + directoryBytes(join(paths.backupsRoot, name)),
    0,
  );
  const budgetBytes = budgetMb * 1024 * 1024;

  return {
    kept: plan.keep,
    removed: plan.remove,
    unknown: plan.unknown,
    bytes,
    budgetMb,
    overBudget: bytes > budgetBytes,
  };
}
