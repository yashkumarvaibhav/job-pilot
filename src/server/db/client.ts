import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export type AppDatabase = ReturnType<typeof drizzle>;

export type DatabaseClient = {
  db: AppDatabase;
  sqlite: Database.Database;
  close: () => void;
};

export function openDatabase(databasePath: string): DatabaseClient {
  if (databasePath.trim().length === 0) {
    throw new Error("An explicit SQLite database path is required.");
  }

  const sqlite = new Database(databasePath);

  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

    return {
      db: drizzle(sqlite),
      sqlite,
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
