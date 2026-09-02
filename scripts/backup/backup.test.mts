import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAccountFoundation } from "../../src/server/db/foundation";
import { openDatabase } from "../../src/server/db/client";
import { migrateDatabase } from "../../src/server/db/migrate";
import { backupStamp, createBackup } from "./backup.mjs";
import { readManifest } from "./manifest.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A throwaway application root laid out exactly like `app/`. */
function scratchApp() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-backup-"));
  scratchRoots.push(root);
  mkdirSync(join(root, "var"), { recursive: true });
  return {
    root,
    databasePath: join(root, "var", "job-pilot.sqlite"),
    uploadsRoot: join(root, "var", "uploads"),
    backupsRoot: join(root, "var", "backups"),
  };
}

function seedTwoTenants(databasePath: string) {
  migrateDatabase(databasePath);
  const client = openDatabase(databasePath);
  try {
    createAccountFoundation(client.db, {
      emailNormalized: "tenant-a@invalid.test",
      passwordHash: "synthetic-password-hash-a",
      displayName: "Tenant A",
      timezone: "Asia/Kolkata",
      ids: { userId: "user-a", workspaceId: "workspace-a" },
      now: new Date("2026-08-31T10:00:00.000Z"),
    });
    createAccountFoundation(client.db, {
      emailNormalized: "tenant-b@invalid.test",
      passwordHash: "synthetic-password-hash-b",
      displayName: "Tenant B",
      timezone: "America/New_York",
      ids: { userId: "user-b", workspaceId: "workspace-b" },
      now: new Date("2026-08-31T11:00:00.000Z"),
    });
  } finally {
    client.close();
  }
}

/** Real JP-0023 rows: the backup contract is checked against the real schema. */
function addDocumentVersion(
  databasePath: string,
  rows: { id: string; storageKey: string; sha256: string }[],
) {
  const database = new Database(databasePath);
  try {
    database.pragma("foreign_keys = ON");
    database
      .prepare(
        "insert into document (id, workspace_id, name, kind, created_at, updated_at) values (?, ?, ?, 'resume', 0, 0)",
      )
      .run("doc-1", "workspace-a", "Backend Java");
    const insert = database.prepare(
      "insert into document_version (id, workspace_id, document_id, label, storage_key, sha256, byte_size, content_type, created_at)" +
        " values (?, 'workspace-a', 'doc-1', ?, ?, ?, ?, 'application/pdf', 0)",
    );
    let index = 0;
    for (const row of rows) {
      index += 1;
      insert.run(
        row.id,
        `v${index}`,
        row.storageKey,
        row.sha256,
        Math.max(1, row.sha256.length),
      );
    }
  } finally {
    database.close();
  }
}

/** A database older than the document migration still backs up and restores. */
function dropDocumentTables(databasePath: string) {
  const database = new Database(databasePath);
  try {
    database.exec("drop table document_usage");
    database.exec("drop table document_version");
    database.exec("drop table document");
  } finally {
    database.close();
  }
}

function writeUpload(uploadsRoot: string, name: string, contents: string) {
  mkdirSync(uploadsRoot, { recursive: true });
  writeFileSync(join(uploadsRoot, name), contents, "utf8");
  return createHash("sha256").update(contents).digest("hex");
}

function filesUnder(directory: string) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("backupStamp", () => {
  it("is sortable, path-safe and explicitly UTC", () => {
    expect(backupStamp(new Date("2026-08-31T21:45:07.123Z"))).toBe(
      "20260831T214507Z",
    );
    expect(
      backupStamp(new Date("2026-01-02T03:04:05.000Z")) <
        backupStamp(new Date("2026-01-02T03:04:06.000Z")),
    ).toBe(true);
  });
});

describe("createBackup — first boot", () => {
  it("records a pre-migration manifest and exits successfully with no database", () => {
    const app = scratchApp();

    const result = createBackup({ appRoot: app.root });

    expect(result.state).toBe("pre-migration");
    expect(result.manifest.snapshot).toBeNull();
    expect(result.manifest.documents).toEqual({
      table: "absent",
      count: 0,
      entries: {},
    });
    expect(readdirSync(result.directory)).toEqual(["manifest.json"]);
    expect(existsSync(app.databasePath)).toBe(false);
  });

  it("treats a database with no user tables as nothing to protect", () => {
    const app = scratchApp();
    new Database(app.databasePath).close();

    expect(createBackup({ appRoot: app.root }).state).toBe("pre-migration");
  });
});

describe("createBackup — captured snapshot", () => {
  it("writes one consistent file with no sidecars, and counts every table", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);

    // The journal lives beside the application, not beside a scratch database.
    const result = createBackup({
      appRoot: app.root,
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });

    expect(result.state).toBe("captured");
    const names = readdirSync(result.directory).sort();
    expect(names).toEqual(["job-pilot.sqlite", "manifest.json", "uploads"]);
    expect(names.some((name) => name.endsWith("-wal") || name.endsWith("-shm"))).toBe(
      false,
    );
    expect(result.manifest.tables.user_account).toBe(2);
    expect(result.manifest.tables.workspace).toBe(2);
    expect(result.manifest.tables.settings).toBe(2);
    expect(result.manifest.schema.appliedMigrations).toBeGreaterThan(0);
    // Read from the journal, not hardcoded: every new migration would otherwise
    // fail a test that has nothing to do with the change being made.
    const journal = JSON.parse(
      readFileSync(resolve("drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(result.manifest.schema.latestTag).toBe(
      journal.entries[journal.entries.length - 1].tag,
    );
    expect(result.manifest.tables.task).toBe(0);
    expect(result.manifest.tables.tag).toBe(0);
    expect(result.manifest.tables.entity_tag).toBe(0);
    expect(result.manifest.tables.notification).toBe(0);
    expect(result.manifest.tables.interview).toBe(0);
    expect(result.manifest.snapshot.bytes).toBeGreaterThan(0);

    const snapshot = new Database(join(result.directory, "job-pilot.sqlite"));
    try {
      expect(snapshot.pragma("integrity_check", { simple: true })).toBe("ok");
      const emails = snapshot
        .prepare("select email_normalized from user_account order by email_normalized")
        .all() as { email_normalized: string }[];
      expect(emails.map((row) => row.email_normalized)).toEqual([
        "tenant-a@invalid.test",
        "tenant-b@invalid.test",
      ]);
    } finally {
      snapshot.close();
    }
  });

  it("copies uploads and records an empty document map for a pre-document database", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    dropDocumentTables(app.databasePath);
    writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume bytes");

    const result = createBackup({ appRoot: app.root });

    expect(result.manifest.documents.table).toBe("absent");
    expect(result.manifest.uploads).toEqual({
      copied: true,
      fileCount: 1,
      bytes: "synthetic resume bytes".length,
    });
    expect(
      readFileSync(join(result.directory, "uploads", "resume.pdf"), "utf8"),
    ).toBe("synthetic resume bytes");
  });

  it("verifies every document file by sha256 once the table exists", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    const sha256 = writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume");
    addDocumentVersion(app.databasePath, [
      { id: "doc-1", storageKey: "resume.pdf", sha256 },
    ]);

    const result = createBackup({ appRoot: app.root });

    expect(result.manifest.documents).toEqual({
      table: "present",
      count: 1,
      entries: {
        "doc-1": {
          storageKey: "resume.pdf",
          sha256,
          bytes: "synthetic resume".length,
        },
      },
    });
  });

  it("fails loudly, and marks the manifest, when a document file is missing", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    const sha256 = writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume");
    addDocumentVersion(app.databasePath, [
      { id: "doc-1", storageKey: "resume.pdf", sha256 },
      { id: "doc-2", storageKey: "cover-letter.pdf", sha256 },
    ]);

    expect(() => createBackup({ appRoot: app.root })).toThrowError(
      /doc-2: file missing/,
    );

    const directory = join(app.backupsRoot, readdirSync(app.backupsRoot)[0]);
    expect(readManifest(directory).state).toBe("failed");
  });

  it("fails when a document file no longer hashes to what its row claims", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume");
    addDocumentVersion(app.databasePath, [
      { id: "doc-1", storageKey: "resume.pdf", sha256: "0".repeat(64) },
    ]);

    expect(() => createBackup({ appRoot: app.root })).toThrowError(
      /doc-1: sha256 mismatch/,
    );
  });

  it("never copies an environment secret into the backup", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    const secret = `token-key-${randomUUID()}`;
    writeFileSync(join(app.root, ".env"), `TOKEN_KEY=${secret}\n`, "utf8");

    const result = createBackup({ appRoot: app.root });

    for (const file of filesUnder(result.directory)) {
      expect(readFileSync(file).toString("latin1")).not.toContain(secret);
    }
    expect(readFileSync(join(result.directory, "manifest.json"), "utf8")).not.toContain(
      "TOKEN_KEY",
    );
  });

  it("gives two backups in the same second their own directories", () => {
    const app = scratchApp();
    seedTwoTenants(app.databasePath);
    const now = new Date("2026-08-31T21:45:07.000Z");

    const first = createBackup({ appRoot: app.root, now });
    const second = createBackup({ appRoot: app.root, now });

    expect(second.directory).not.toBe(first.directory);
    expect(readdirSync(app.backupsRoot).sort()).toEqual([
      "20260831T214507Z",
      "20260831T214507Z-1",
    ]);
  });
});
