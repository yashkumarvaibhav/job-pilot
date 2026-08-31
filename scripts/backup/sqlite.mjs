// Small SQLite helpers shared by backup, restore and the migration guard.
import Database from "better-sqlite3";

export const BUSY_TIMEOUT_MS = 5_000;

// Tables SQLite or Drizzle own. They are still backed up and still counted —
// `__drizzle_migrations` is how a restore proves it carries the same schema —
// but they are not evidence that a workspace has any data worth protecting.
const INTERNAL_TABLES = new Set(["__drizzle_migrations"]);

/**
 * Open a database without altering it. The backup path deliberately does not
 * set `journal_mode`: changing the journal of a database another process is
 * serving is a write, and a backup must never be one.
 */
export function openReadable(databasePath, options = {}) {
  const database = new Database(databasePath, {
    fileMustExist: options.fileMustExist ?? true,
  });
  database.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return database;
}

export function listTables(database) {
  return database
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    )
    .all()
    .map((row) => row.name);
}

export function listUserTables(database) {
  return listTables(database).filter((name) => !INTERNAL_TABLES.has(name));
}

export function tableExists(database, tableName) {
  return (
    database
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
      )
      .get(tableName) !== undefined
  );
}

export function countRows(database, tableName) {
  // Table names cannot be bound as parameters; they come from sqlite_master,
  // never from user input, and are quoted so an exotic name still works.
  const quoted = `"${tableName.replaceAll('"', '""')}"`;
  return database.prepare(`select count(*) as count from ${quoted}`).get().count;
}

export function countAllTables(database) {
  const counts = {};
  for (const table of listTables(database)) {
    counts[table] = countRows(database, table);
  }
  return counts;
}
