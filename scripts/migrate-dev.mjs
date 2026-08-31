// Development only. Applies the committed drizzle/ migrations to a local
// database so `npm run dev` has a schema to work against.
//
// This is NOT the production migration path. JP-0044 owns `npm run db:migrate`,
// which takes a verified backup before it touches a live database (D-026).
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

if (process.env.NODE_ENV === "production") {
  console.error(
    "migrate-dev refuses to run with NODE_ENV=production. Use the guarded migration command.",
  );
  process.exit(1);
}

const databasePath = resolve(
  process.env.DATABASE_PATH?.trim() || "./var/job-pilot.sqlite",
);

mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);

try {
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");
  migrate(drizzle(sqlite), { migrationsFolder: resolve("drizzle") });
  console.log(`migrated ${databasePath}`);
} finally {
  sqlite.close();
}
