#!/usr/bin/env node
// `npm run backup:selftest` — the end-to-end story, run against scratch data:
// seed a database with documents and files, back it up *while another process
// is writing to it*, restore it, and prove what came back. Then the first-boot
// case, which must succeed on a database that does not exist yet.
//
// This is the test that keeps the claim honest. Unit tests cover the branches;
// this one runs the real command against a real concurrent writer.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createBackup } from "./backup/backup.mjs";
import { restoreBackup } from "./backup/restore.mjs";

const APP_ROOT = process.cwd();
const MIGRATIONS_FOLDER = resolve(APP_ROOT, "drizzle");

// Runs in its own process so the backup really does contend with a writer.
const WRITER = resolve(APP_ROOT, "scripts", "backup", "selftest-writer.mjs");

function seedDatabase(databasePath) {
  const database = new Database(databasePath);
  try {
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    migrate(drizzle(database), { migrationsFolder: MIGRATIONS_FOLDER });

    const at = Date.parse("2026-08-31T10:00:00.000Z");
    const insertUser = database.prepare(
      "insert into user_account (id, email_normalized, password_hash, status, created_at, updated_at) values (?, ?, ?, 'active', ?, ?)",
    );
    const insertWorkspace = database.prepare(
      "insert into workspace (id, owner_user_id, created_at) values (?, ?, ?)",
    );
    const insertSettings = database.prepare(
      "insert into settings (workspace_id, display_name, timezone) values (?, ?, ?)",
    );
    for (const [tenant, zone] of [
      ["a", "Asia/Kolkata"],
      ["b", "America/New_York"],
    ]) {
      insertUser.run(
        `user-${tenant}`,
        `tenant-${tenant}@invalid.test`,
        `synthetic-password-hash-${tenant}`,
        at,
        at,
      );
      insertWorkspace.run(`workspace-${tenant}`, `user-${tenant}`, at);
      insertSettings.run(`workspace-${tenant}`, `Tenant ${tenant.toUpperCase()}`, zone);
    }

    // JP-0023 owns this table; until then the self-test stands in for it, so
    // the pairing rules are exercised before there is real data to lose.
    database.exec(
      "create table document_version (id text primary key, storage_key text not null, sha256 text not null)",
    );
  } finally {
    database.close();
  }
}

function seedDocuments(databasePath, uploadsRoot, count) {
  mkdirSync(uploadsRoot, { recursive: true });
  const database = new Database(databasePath);
  try {
    const insert = database.prepare(
      "insert into document_version (id, storage_key, sha256) values (?, ?, ?)",
    );
    for (let index = 0; index < count; index += 1) {
      const storageKey = `resume-${index}.pdf`;
      const contents = `synthetic document ${index}\n`;
      writeFileSync(join(uploadsRoot, storageKey), contents, "utf8");
      insert.run(
        `doc-${index}`,
        storageKey,
        createHash("sha256").update(contents).digest("hex"),
      );
    }
  } finally {
    database.close();
  }
}

function scratchRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `job-pilot-selftest-${label}-`));
  mkdirSync(join(root, "var"), { recursive: true });
  return root;
}

/** Rows the writer has committed, read from its own connection's point of view. */
function committedEvents(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database.prepare("select count(*) as count from activity_event").get().count;
  } finally {
    database.close();
  }
}

/**
 * Run `action` while a separate process writes to the database. It waits for
 * real committed rows rather than a fixed sleep: loading a native module takes
 * long enough that a blind wait can start the snapshot before the writer has
 * opened the file at all, which quietly turns this into a test of nothing.
 */
async function withWriter(databasePath, action) {
  const writer = spawn(
    process.execPath,
    [WRITER, databasePath, process.env.JP_WRITER_LOG ?? ""],
    { cwd: APP_ROOT, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  writer.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolveExit) => writer.on("exit", resolveExit));

  try {
    const deadline = Date.now() + 15_000;
    while (committedEvents(databasePath) === 0) {
      assert.equal(writer.exitCode, null, `the writer died: ${stderr}`);
      assert.ok(Date.now() < deadline, "the writer never committed a row");
      await new Promise((wake) => setTimeout(wake, 25));
    }
    return action();
  } finally {
    writer.kill("SIGKILL");
    await exited;
  }
}

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: condition });
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function concurrentWriterCase() {
  const root = scratchRoot("busy");
  try {
    const databasePath = join(root, "var", "job-pilot.sqlite");
    const uploadsRoot = join(root, "var", "uploads");
    seedDatabase(databasePath);
    seedDocuments(databasePath, uploadsRoot, 3);

    const backup = await withWriter(databasePath, () =>
      createBackup({ appRoot: root, migrationsFolder: MIGRATIONS_FOLDER }),
    );

    check("backup of a database under concurrent writes is captured", backup.state === "captured");
    check(
      "every document is hashed and recorded in the manifest",
      Object.keys(backup.manifest.documents.entries).length === 3,
    );
    check(
      "the manifest records a schema version",
      backup.manifest.schema.latestTag === "0012_interview",
      backup.manifest.schema.latestTag ?? "none",
    );

    const captured = backup.manifest.tables.activity_event;
    check(
      "the snapshot holds rows another process committed while it ran",
      captured > 0,
      `${captured} event(s) captured`,
    );

    const restored = restoreBackup({
      appRoot: root,
      directory: backup.directory,
      into: join(root, "var", "tmp", "verify.sqlite"),
    });

    // Reaching this line at all means integrity_check and foreign_key_check
    // passed: restore throws on either. The corruption case below proves the
    // check is real rather than a line that always prints ok.
    check("restore passes integrity_check and foreign_key_check", true);
    check(
      "every per-table count matches the manifest",
      restored.counts.every((row) => row.manifest === row.restored),
    );
    check("every document hash resolves against the backed-up files", restored.documents.verified === 3);
    check(
      "both synthetic tenants survive the round trip",
      restored.counts.find((row) => row.table === "workspace")?.restored === 2,
    );
    check("the live database was not touched", restored.live === false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function corruptSnapshotCase() {
  const root = scratchRoot("corrupt");
  try {
    const databasePath = join(root, "var", "job-pilot.sqlite");
    seedDatabase(databasePath);
    seedDocuments(databasePath, join(root, "var", "uploads"), 1);
    const backup = createBackup({ appRoot: root, migrationsFolder: MIGRATIONS_FOLDER });

    const snapshotPath = join(backup.directory, backup.manifest.snapshot.file);
    const bytes = readFileSync(snapshotPath);
    bytes.fill(0x6a, 4096, 8192); // clobber a whole page of the snapshot
    writeFileSync(snapshotPath, bytes);

    let refused = false;
    try {
      restoreBackup({
        appRoot: root,
        directory: backup.directory,
        into: join(root, "var", "tmp", "verify.sqlite"),
      });
    } catch {
      refused = true;
    }
    check("a corrupted snapshot is refused, not restored", refused);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function firstBootCase() {
  const root = scratchRoot("firstboot");
  try {
    const empty = createBackup({ appRoot: root, migrationsFolder: MIGRATIONS_FOLDER });
    check(
      "a database that does not exist yet backs up successfully",
      empty.state === "pre-migration",
    );

    new Database(join(root, "var", "job-pilot.sqlite")).close();
    const tableless = createBackup({ appRoot: root, migrationsFolder: MIGRATIONS_FOLDER });
    check(
      "a database with no user tables backs up successfully",
      tableless.state === "pre-migration",
    );
    check(
      "the empty manifest records no documents",
      tableless.manifest.documents.count === 0,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

await concurrentWriterCase();
corruptSnapshotCase();
firstBootCase();

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length} passed, ${failed.length} failed`,
);
process.exitCode = failed.length === 0 ? 0 : 1;
