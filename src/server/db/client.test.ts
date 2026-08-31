import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, SQLITE_BUSY_TIMEOUT_MS } from "./client";

describe("openDatabase", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("configures a bounded WAL connection for an explicit file", () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-db-"));
    temporaryDirectories.push(directory);
    const client = openDatabase(join(directory, "test.sqlite"));

    try {
      expect(client.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(client.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(client.sqlite.pragma("busy_timeout", { simple: true })).toBe(
        SQLITE_BUSY_TIMEOUT_MS,
      );
      expect(client.db).toBeDefined();
    } finally {
      client.close();
    }
  });

  it("rejects an implicit database path", () => {
    expect(() => openDatabase("  ")).toThrow(
      "An explicit SQLite database path is required.",
    );
  });
});
