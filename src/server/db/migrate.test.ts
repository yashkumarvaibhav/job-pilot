import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "./client";
import { migrateDatabase } from "./migrate";

describe("migrateDatabase", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("applies committed migrations to an explicit temporary path", () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-migrate-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "nested", "test.sqlite");

    migrateDatabase(databasePath);
    migrateDatabase(databasePath);

    const client = openDatabase(databasePath);
    try {
      const tables = client.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' order by name",
        )
        .all() as { name: string }[];
      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "account_token",
          "activity_event",
          "auth_session",
          "company",
          "settings",
          "user_account",
          "workspace",
        ]),
      );
      expect(
        client.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 2 });

      for (const indexName of [
        "company_workspace_id_id_unique",
        "company_workspace_name_idx",
        "settings_workspace_idx",
        "activity_event_workspace_id_id_unique",
        "activity_event_workspace_at_idx",
        "activity_event_workspace_entity_idx",
      ]) {
        const columns = client.sqlite
          .prepare(
            "select name from pragma_index_info(?) order by seqno",
          )
          .all(indexName) as { name: string }[];
        expect(columns[0]?.name, indexName).toBe("workspace_id");
      }

      const activityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('activity_event')",
        )
        .all();
      expect(activityForeignKeys).toContainEqual({
        table: "workspace",
        from: "workspace_id",
        to: "id",
      });

      const companyColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('company') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(companyColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "name",
        "website",
        "careers_url",
        "industry",
        "type",
        "locations",
        "target",
        "notes",
        "created_at",
      ]);
      expect(companyColumns.find((column) => column.name === "name")?.notnull).toBe(
        1,
      );
      expect(
        companyColumns.find((column) => column.name === "target")?.dflt_value,
      ).toBe("false");

      const companyForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('company')",
        )
        .all();
      expect(companyForeignKeys).toContainEqual({
        table: "workspace",
        from: "workspace_id",
        to: "id",
      });
    } finally {
      client.close();
    }
  });
});
