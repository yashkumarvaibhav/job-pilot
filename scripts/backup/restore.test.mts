import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createAccountFoundation } from "../../src/server/db/foundation";
import { openDatabase } from "../../src/server/db/client";
import { migrateDatabase } from "../../src/server/db/migrate";
import { createBackup } from "./backup.mjs";
import { readManifest, writeManifest } from "./manifest.mjs";
import { restoreBackup } from "./restore.mjs";
import { parseRestoreArguments } from "../restore-cli.mjs";

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function scratchApp() {
  const root = mkdtempSync(join(tmpdir(), "job-pilot-restore-"));
  scratchRoots.push(root);
  mkdirSync(join(root, "var"), { recursive: true });
  return {
    root,
    databasePath: join(root, "var", "job-pilot.sqlite"),
    uploadsRoot: join(root, "var", "uploads"),
    backupsRoot: join(root, "var", "backups"),
    scratchTarget: join(root, "var", "tmp", "verify.sqlite"),
  };
}

/** Two synthetic tenants, each with a live session and an unused reset token. */
function seedTenants(databasePath: string) {
  migrateDatabase(databasePath);
  const client = openDatabase(databasePath);
  try {
    for (const tenant of ["a", "b"]) {
      createAccountFoundation(client.db, {
        usernameNormalized: `tenant-${tenant}@invalid.test`,
        passwordHash: `synthetic-password-hash-${tenant}`,
        displayName: `Tenant ${tenant.toUpperCase()}`,
        timezone: tenant === "a" ? "Asia/Kolkata" : "America/New_York",
        ids: { userId: `user-${tenant}`, workspaceId: `workspace-${tenant}` },
        now: new Date("2026-08-31T10:00:00.000Z"),
      });
    }
  } finally {
    client.close();
  }

  const database = new Database(databasePath);
  try {
    const at = Date.parse("2026-08-31T10:00:00.000Z");
    for (const tenant of ["a", "b"]) {
      database
        .prepare(
          "insert into auth_session (id, user_id, token_digest, created_at, last_seen_at, idle_expires_at, absolute_expires_at) values (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          `session-${tenant}`,
          `user-${tenant}`,
          `digest-${tenant}`,
          at,
          at,
          at + 3_600_000,
          at + 86_400_000,
        );
      database
        .prepare(
          "insert into account_token (id, user_id, purpose, token_digest, expires_at, used_at) values (?, ?, 'reset_password', ?, ?, null)",
        )
        .run(`token-${tenant}`, `user-${tenant}`, `token-digest-${tenant}`, at + 3_600_000);
    }
    database
      .prepare(
        "insert into account_token (id, user_id, purpose, token_digest, expires_at, used_at) values ('token-used', 'user-a', 'verify_email', 'token-digest-used', ?, ?)",
      )
      .run(at + 3_600_000, at);
  } finally {
    database.close();
  }
}

function writeUpload(uploadsRoot: string, name: string, contents: string) {
  mkdirSync(uploadsRoot, { recursive: true });
  writeFileSync(join(uploadsRoot, name), contents, "utf8");
  return createHash("sha256").update(contents).digest("hex");
}

/** Real JP-0023 rows, so restore verification runs against the real schema. */
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

describe("parseRestoreArguments", () => {
  it("reads a directory, --into in both spellings, and --force", () => {
    expect(parseRestoreArguments(["dir", "--into", "/tmp/x.sqlite"])).toEqual({
      directory: "dir",
      into: "/tmp/x.sqlite",
      force: false,
    });
    expect(parseRestoreArguments(["dir", "--into=/tmp/x.sqlite"])).toEqual({
      directory: "dir",
      into: "/tmp/x.sqlite",
      force: false,
    });
    expect(parseRestoreArguments(["dir", "--force"]).force).toBe(true);
  });

  it("refuses an unknown option, a second directory and an empty --into", () => {
    expect(() => parseRestoreArguments(["dir", "--wat"])).toThrowError(/unknown option/);
    expect(() => parseRestoreArguments(["a", "b"])).toThrowError(/unexpected argument/);
    expect(() => parseRestoreArguments(["dir", "--into"])).toThrowError(/needs a path/);
  });
});

describe("restoreBackup — verification", () => {
  it("restores to a scratch path and never touches the live database", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });
    const before = statSync(app.databasePath);

    const result = restoreBackup({
      appRoot: app.root,
      directory: backup.directory,
      into: app.scratchTarget,
    });

    expect(result.target).toBe(app.scratchTarget);
    expect(result.live).toBe(false);
    expect(statSync(app.databasePath).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(app.databasePath).size).toBe(before.size);
    expect(
      result.counts.find((row) => row.table === "user_account"),
    ).toEqual({ table: "user_account", manifest: 2, restored: 2 });
    expect(result.revoked).toEqual({ sessions: 0, accountTokens: 0 });
  });

  it("preserves both tenants, their workspace ownership and composite keys", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });

    restoreBackup({
      appRoot: app.root,
      directory: backup.directory,
      into: app.scratchTarget,
    });

    const restored = new Database(app.scratchTarget);
    try {
      expect(restored.pragma("foreign_key_check")).toEqual([]);
      const owners = restored
        .prepare("select id, owner_user_id from workspace order by id")
        .all() as { id: string; owner_user_id: string }[];
      expect(owners).toEqual([
        { id: "workspace-a", owner_user_id: "user-a" },
        { id: "workspace-b", owner_user_id: "user-b" },
      ]);
      const foreignKeys = restored
        .prepare("select \"table\", \"from\", \"to\" from pragma_foreign_key_list('activity_event')")
        .all();
      expect(foreignKeys).toContainEqual({
        table: "workspace",
        from: "workspace_id",
        to: "id",
      });
      // The tenants' own rows survive as their own: A's settings still belong to A.
      const settings = restored
        .prepare("select workspace_id, timezone from settings order by workspace_id")
        .all() as { workspace_id: string; timezone: string }[];
      expect(settings).toEqual([
        { workspace_id: "workspace-a", timezone: "Asia/Kolkata" },
        { workspace_id: "workspace-b", timezone: "America/New_York" },
      ]);
    } finally {
      restored.close();
    }
  });

  it("re-verifies document references against the backed-up files by hash", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const sha256 = writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume");
    addDocumentVersion(app.databasePath, [
      { id: "doc-1", storageKey: "resume.pdf", sha256 },
    ]);
    const backup = createBackup({ appRoot: app.root });

    expect(
      restoreBackup({
        appRoot: app.root,
        directory: backup.directory,
        into: app.scratchTarget,
      }).documents,
    ).toEqual({ verified: 1 });

    // Row counts alone would still pass once the file is gone. The hash check
    // is the only thing standing between the operator and a trusted backup
    // that cannot produce a single document.
    rmSync(join(backup.directory, "uploads", "resume.pdf"));
    expect(() =>
      restoreBackup({
        appRoot: app.root,
        directory: backup.directory,
        into: app.scratchTarget,
      }),
    ).toThrowError(/doc-1: file missing/);
  });

  it("refuses a manifest whose counts no longer describe the snapshot", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });
    const manifest = readManifest(backup.directory);
    writeManifest(backup.directory, {
      ...manifest,
      tables: { ...manifest.tables, user_account: 99 },
    });

    expect(() =>
      restoreBackup({
        appRoot: app.root,
        directory: backup.directory,
        into: app.scratchTarget,
      }),
    ).toThrowError(/user_account: manifest 99, restored 2/);
  });

  it("refuses a backup that is not in the captured state", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });
    writeManifest(backup.directory, {
      ...readManifest(backup.directory),
      state: "failed",
    });

    expect(() =>
      restoreBackup({
        appRoot: app.root,
        directory: backup.directory,
        into: app.scratchTarget,
      }),
    ).toThrowError(/is 'failed', not 'captured'/);
  });

  it("refuses a missing directory and a missing snapshot file", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });

    expect(() =>
      restoreBackup({ appRoot: app.root, directory: join(app.root, "nope") }),
    ).toThrowError(/No backup directory/);

    rmSync(join(backup.directory, "job-pilot.sqlite"));
    expect(() =>
      restoreBackup({
        appRoot: app.root,
        directory: backup.directory,
        into: app.scratchTarget,
      }),
    ).toThrowError(/snapshot .* is missing/);
  });
});

describe("restoreBackup — the live database", () => {
  it(
    "refuses to overwrite it without --force",
    () => {
      const app = scratchApp();
      seedTenants(app.databasePath);
      const backup = createBackup({ appRoot: app.root });
      const before = readFileSync(app.databasePath);

      expect(() =>
        restoreBackup({ appRoot: app.root, directory: backup.directory }),
      ).toThrowError(/Refusing to overwrite the live database/);
      expect(() =>
        restoreBackup({
          appRoot: app.root,
          directory: backup.directory,
          into: app.databasePath,
        }),
      ).toThrowError(/Refusing to overwrite the live database/);
      expect(readFileSync(app.databasePath)).toEqual(before);
    },
    15_000,
  );

  it("revokes every restored session and unused account token with --force", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const sha256 = writeUpload(app.uploadsRoot, "resume.pdf", "synthetic resume");
    addDocumentVersion(app.databasePath, [
      { id: "doc-1", storageKey: "resume.pdf", sha256 },
    ]);
    const backup = createBackup({ appRoot: app.root });
    rmSync(join(app.uploadsRoot, "resume.pdf"));

    const result = restoreBackup({
      appRoot: app.root,
      directory: backup.directory,
      force: true,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });

    expect(result.live).toBe(true);
    expect(result.revoked).toEqual({ sessions: 2, accountTokens: 2 });
    expect(result.uploads.restored).toBe(1);
    expect(existsSync(join(app.uploadsRoot, "resume.pdf"))).toBe(true);

    const database = new Database(app.databasePath);
    try {
      expect(
        database.prepare("select count(*) as count from auth_session where revoked_at is null").get(),
      ).toEqual({ count: 0 });
      expect(
        database.prepare("select count(*) as count from account_token").get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare("select id from account_token").get(),
      ).toEqual({ id: "token-used" });
      // Both tenants are still here; revocation is not deletion of accounts.
      expect(
        database.prepare("select count(*) as count from user_account").get(),
      ).toEqual({ count: 2 });
    } finally {
      database.close();
    }
  });

  it("clears stale sidecars so a foreign write-ahead log cannot be replayed", () => {
    const app = scratchApp();
    seedTenants(app.databasePath);
    const backup = createBackup({ appRoot: app.root });
    mkdirSync(join(app.root, "var", "tmp"), { recursive: true });
    writeFileSync(`${app.scratchTarget}-wal`, "stale", "utf8");

    restoreBackup({
      appRoot: app.root,
      directory: backup.directory,
      into: app.scratchTarget,
    });

    expect(existsSync(`${app.scratchTarget}-wal`)).toBe(false);
    expect(readdirSync(join(app.root, "var", "tmp"))).toEqual(["verify.sqlite"]);
  });
});
