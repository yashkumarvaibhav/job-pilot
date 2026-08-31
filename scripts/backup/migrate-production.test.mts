import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "../../src/server/db/migrate";
import { createBackup } from "./backup.mjs";
import { readManifest } from "./manifest.mjs";
import { applyMigrations, pendingMigrationsFor } from "./migrations.mjs";
import { runGuardedMigration } from "./migrate-production.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function scratchApp() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-migrate-"));
  scratchRoots.push(root);
  mkdirSync(join(root, "var"), { recursive: true });
  return {
    root,
    databasePath: join(root, "var", "job-pilot.sqlite"),
    uploadsRoot: join(root, "var", "uploads"),
    backupsRoot: join(root, "var", "backups"),
  };
}

/**
 * A migrations folder we control, so "pending" is a fact of the fixture rather
 * than something that depends on the project's real migration history.
 */
function scratchMigrations(root: string, statements: string[]) {
  const folder = join(root, "migrations");
  mkdirSync(join(folder, "meta"), { recursive: true });
  const entries = statements.map((sql, index) => {
    const tag = `000${index}_step`;
    writeFileSync(join(folder, `${tag}.sql`), sql, "utf8");
    return { idx: index, version: "7", when: 1_700_000_000_000 + index, tag, breakpoints: true };
  });
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
    "utf8",
  );
  return folder;
}

function tableNames(databasePath: string) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return (
      database
        .prepare(
          "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
  } finally {
    database.close();
  }
}

describe("pendingMigrationsFor", () => {
  it("reports every migration on first boot without creating the database", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, [
      "create table first (id text primary key);",
      "create table second (id text primary key);",
    ]);

    expect(pendingMigrationsFor(app.databasePath, folder).map((entry) => entry.tag)).toEqual([
      "0000_step",
      "0001_step",
    ]);
    expect(existsSync(app.databasePath)).toBe(false);
  });

  it("reports nothing once everything is applied, and the next one after that", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);
    applyMigrations(app.databasePath, folder);

    expect(pendingMigrationsFor(app.databasePath, folder)).toEqual([]);

    const grown = scratchMigrations(app.root, [
      "create table first (id text primary key);",
      "create table second (id text primary key);",
    ]);
    expect(pendingMigrationsFor(app.databasePath, grown).map((entry) => entry.tag)).toEqual([
      "0001_step",
    ]);
  });
});

describe("runGuardedMigration", () => {
  it("takes no backup at all when nothing is pending", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);
    applyMigrations(app.databasePath, folder);

    const result = runGuardedMigration({
      appRoot: app.root,
      migrationsFolder: folder,
    });

    expect(result).toEqual({ pending: [], backup: null, applied: false });
    expect(existsSync(app.backupsRoot)).toBe(false);
  });

  it("backs up first, then applies, when a migration is pending", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);
    applyMigrations(app.databasePath, folder);
    const grown = scratchMigrations(app.root, [
      "create table first (id text primary key);",
      "create table second (id text primary key);",
    ]);

    const result = runGuardedMigration({ appRoot: app.root, migrationsFolder: grown });

    expect(result.applied).toBe(true);
    expect(result.pending.map((entry) => entry.tag)).toEqual(["0001_step"]);
    expect(result.backup.state).toBe("captured");
    // The snapshot is of the schema as it was *before* the migration ran.
    expect(tableNames(join(result.backup.directory, "job-pilot.sqlite"))).toEqual([
      "__drizzle_migrations",
      "first",
    ]);
    expect(tableNames(app.databasePath)).toEqual([
      "__drizzle_migrations",
      "first",
      "second",
    ]);
  });

  it("first boot migrates behind a pre-migration manifest", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);

    const result = runGuardedMigration({ appRoot: app.root, migrationsFolder: folder });

    expect(result.applied).toBe(true);
    expect(result.backup.state).toBe("pre-migration");
    expect(tableNames(app.databasePath)).toContain("first");
  });

  it("refuses the migration when the backup cannot be verified", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);
    applyMigrations(app.databasePath, folder);

    // A document row whose file is gone: the backup fails its own verification.
    const database = new Database(app.databasePath);
    database.exec(
      "create table document_version (id text primary key, storage_key text not null, sha256 text not null)",
    );
    database
      .prepare("insert into document_version (id, storage_key, sha256) values (?, ?, ?)")
      .run("doc-1", "gone.pdf", createHash("sha256").update("gone").digest("hex"));
    database.close();

    const grown = scratchMigrations(app.root, [
      "create table first (id text primary key);",
      "create table second (id text primary key);",
    ]);

    expect(() =>
      runGuardedMigration({ appRoot: app.root, migrationsFolder: grown }),
    ).toThrowError(/doc-1: file missing/);

    // The schema is exactly where it was, and the evidence is on disk.
    expect(tableNames(app.databasePath)).not.toContain("second");
    expect(pendingMigrationsFor(app.databasePath, grown).map((entry) => entry.tag)).toEqual([
      "0001_step",
    ]);
    const failedDirectory = join(app.backupsRoot, readdirSync(app.backupsRoot)[0]);
    expect(readManifest(failedDirectory).state).toBe("failed");
  });

  it("never applies anything if the backup step throws for any other reason", () => {
    const app = scratchApp();
    const folder = scratchMigrations(app.root, ["create table first (id text primary key);"]);
    applyMigrations(app.databasePath, folder);
    const grown = scratchMigrations(app.root, [
      "create table first (id text primary key);",
      "create table second (id text primary key);",
    ]);

    expect(() =>
      runGuardedMigration({
        appRoot: app.root,
        migrationsFolder: grown,
        createBackup: () => {
          throw new Error("no space left on device");
        },
      }),
    ).toThrowError(/no space left on device/);
    expect(tableNames(app.databasePath)).not.toContain("second");
  });
});

describe("the two migration entry points", () => {
  it("produce the same schema, so neither can drift from the other", () => {
    const app = scratchApp();
    const viaOperationalTool = join(app.root, "var", "tool.sqlite");
    const viaApplication = join(app.root, "var", "app.sqlite");

    applyMigrations(viaOperationalTool, resolve(process.cwd(), "drizzle"));
    migrateDatabase(viaApplication);

    const schemaOf = (path: string) => {
      const database = new Database(path, { readonly: true });
      try {
        return (
          database
            .prepare("select type, name, sql from sqlite_master order by type, name")
            .all() as { type: string; name: string; sql: string | null }[]
        ).filter((row) => row.name !== "__drizzle_migrations");
      } finally {
        database.close();
      }
    };

    expect(schemaOf(viaOperationalTool)).toEqual(schemaOf(viaApplication));
    const pragmasOf = (path: string) => {
      const database = new Database(path, { readonly: true });
      try {
        return database.pragma("journal_mode", { simple: true });
      } finally {
        database.close();
      }
    };
    expect(pragmasOf(viaOperationalTool)).toBe(pragmasOf(viaApplication));
  });
});

describe("createBackup and the guard share one definition of first boot", () => {
  it("agrees that an empty database is nothing to protect", () => {
    const app = scratchApp();
    new Database(app.databasePath).close();

    expect(createBackup({ appRoot: app.root }).state).toBe("pre-migration");
  });
});
