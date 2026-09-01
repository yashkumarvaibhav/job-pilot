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
          "contact",
          "contact_method",
          "settings",
          "user_account",
          "workspace",
        ]),
      );
      expect(
        client.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 3 });

      for (const indexName of [
        "company_workspace_id_id_unique",
        "company_workspace_name_idx",
        "contact_workspace_id_id_unique",
        "contact_workspace_name_idx",
        "contact_workspace_company_idx",
        "contact_workspace_status_idx",
        "contact_workspace_follow_up_idx",
        "contact_method_workspace_id_id_unique",
        "contact_method_workspace_contact_idx",
        "contact_method_workspace_kind_value_unique",
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

      const contactColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('contact') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(contactColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "company_id",
        "name",
        "designation",
        "relationship",
        "source",
        "location",
        "notes",
        "tags_json",
        "preferred_contact_channel",
        "networking_status",
        "last_interaction_at",
        "next_action",
        "follow_up_on",
        "created_at",
      ]);
      expect(
        contactColumns.find((column) => column.name === "networking_status")
          ?.dflt_value,
      ).toBe("'not_contacted'");
      expect(
        contactColumns.find((column) => column.name === "relationship")
          ?.dflt_value,
      ).toBe("'unknown_cold_contact'");
      expect(
        contactColumns.find((column) => column.name === "tags_json")
          ?.dflt_value,
      ).toBe("'[]'");

      const contactCompanyForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('contact') where \"table\" = 'company' order by seq",
        )
        .all();
      expect(contactCompanyForeignKeys).toEqual([
        { table: "company", from: "workspace_id", to: "workspace_id" },
        { table: "company", from: "company_id", to: "id" },
      ]);

      const contactMethodColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('contact_method') order by cid",
        )
        .all() as { name: string }[];
      expect(contactMethodColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "contact_id",
        "kind",
        "value",
        "value_normalized",
        "is_primary",
        "created_at",
      ]);
      const contactMethodForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('contact_method') where \"table\" = 'contact' order by seq",
        )
        .all();
      expect(contactMethodForeignKeys).toEqual([
        { table: "contact", from: "workspace_id", to: "workspace_id" },
        { table: "contact", from: "contact_id", to: "id" },
      ]);
    } finally {
      client.close();
    }
  });
});
