// Reading migration state without applying anything.
//
// Drizzle records applied migrations in `__drizzle_migrations` and decides what
// to apply by comparing each journal entry's `when` against the newest applied
// `created_at`. The guard mirrors that rule exactly: if it disagreed with the
// migrator, "nothing pending" could skip a backup that a migration then needed.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { BUSY_TIMEOUT_MS, openReadable, tableExists } from "./sqlite.mjs";

export const DEFAULT_MIGRATIONS_FOLDER = "./drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

export function resolveMigrationsFolder(appRoot = process.cwd(), folder) {
  return resolve(appRoot, folder ?? DEFAULT_MIGRATIONS_FOLDER);
}

/**
 * @typedef {{ idx: number, tag: string, when: number }} JournalEntry
 */

/** @returns {JournalEntry[]} */
export function readJournalEntries(migrationsFolder) {
  const journalPath = join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    return [];
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  return (journal.entries ?? []).map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    when: entry.when,
  }));
}

export function readAppliedMigrations(database) {
  if (!tableExists(database, MIGRATIONS_TABLE)) {
    return { count: 0, latestAt: null };
  }
  const row = database
    .prepare(
      `select count(*) as count, max(created_at) as latest from ${MIGRATIONS_TABLE}`,
    )
    .get();
  return { count: row.count, latestAt: row.latest ?? null };
}

/**
 * Journal entries the migrator would still apply, oldest first.
 * @returns {JournalEntry[]}
 */
export function pendingMigrations(database, migrationsFolder) {
  const applied = readAppliedMigrations(database);
  const threshold = applied.latestAt ?? -1;
  return readJournalEntries(migrationsFolder)
    .filter((entry) => entry.when > threshold)
    .sort((left, right) => left.when - right.when);
}

/** The human-readable schema stamp recorded in a manifest. */
export function schemaStamp(database, migrationsFolder) {
  const applied = readAppliedMigrations(database);
  const journal = readJournalEntries(migrationsFolder);
  const latestTag =
    journal
      .filter((entry) => applied.latestAt !== null && entry.when <= applied.latestAt)
      .sort((left, right) => left.when - right.when)
      .at(-1)?.tag ?? null;
  return {
    appliedMigrations: applied.count,
    latestMigrationAt: applied.latestAt,
    latestTag,
  };
}

/**
 * Pending migrations for a database that may not exist yet. Nothing here
 * creates the file: on first boot every journal entry is pending, and the
 * migrator is what brings the database into being.
 * @returns {JournalEntry[]}
 */
export function pendingMigrationsFor(databasePath, migrationsFolder) {
  if (!existsSync(databasePath)) {
    return readJournalEntries(migrationsFolder).sort(
      (left, right) => left.when - right.when,
    );
  }
  const database = openReadable(databasePath);
  try {
    return pendingMigrations(database, migrationsFolder);
  } finally {
    database.close();
  }
}

/**
 * Apply migrations with the same primitive the application uses: Drizzle's
 * migrator, on a connection with this project's pragmas. `src/server/db/migrate.ts`
 * wraps the identical call for tests and development; a regression test asserts
 * the two produce the same schema, because two owners of one fact drift.
 */
export function applyMigrations(databasePath, migrationsFolder) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    migrate(drizzle(sqlite), { migrationsFolder });
  } finally {
    sqlite.close();
  }
}
