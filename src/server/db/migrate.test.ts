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
          "interaction",
          "opportunity",
          "opportunity_contact",
          "application",
          "referral_request",
          "settings",
          "user_account",
          "workspace",
        ]),
      );
      expect(
        client.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 8 });

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
        "interaction_workspace_id_id_unique",
        "interaction_workspace_contact_idx",
        "interaction_workspace_company_idx",
        "interaction_workspace_opportunity_idx",
        "interaction_workspace_referral_idx",
        "interaction_workspace_occurred_idx",
        "interaction_workspace_need_reply_idx",
        "opportunity_workspace_id_id_unique",
        "opportunity_workspace_company_idx",
        "opportunity_workspace_bucket_idx",
        "opportunity_workspace_stage_idx",
        "opportunity_workspace_deadline_idx",
        "opportunity_workspace_company_job_id_unique",
        "opportunity_contact_workspace_id_id_unique",
        "opportunity_contact_workspace_pair_unique",
        "opportunity_contact_workspace_opportunity_idx",
        "opportunity_contact_workspace_contact_idx",
        "application_workspace_id_id_unique",
        "application_workspace_opportunity_unique",
        "application_workspace_stage_idx",
        "application_workspace_applied_on_idx",
        "referral_request_workspace_id_id_unique",
        "referral_request_workspace_contact_idx",
        "referral_request_workspace_opportunity_idx",
        "referral_request_workspace_stage_idx",
        "referral_request_workspace_requested_on_idx",
        "referral_request_workspace_follow_up_idx",
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

      const interactionColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('interaction') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(interactionColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "contact_id",
        "company_id",
        "opportunity_id",
        "referral_id",
        "channel",
        "direction",
        "occurred_at",
        "body",
        "email_message_id",
        "requires_reply",
        "reply_resolved_at",
        "created_at",
      ]);
      expect(
        interactionColumns.find((column) => column.name === "requires_reply")
          ?.dflt_value,
      ).toBe("false");
      expect(
        interactionColumns.find((column) => column.name === "body")?.dflt_value,
      ).toBe("''");

      const interactionContactForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('interaction') where \"table\" = 'contact' order by seq",
        )
        .all();
      expect(interactionContactForeignKeys).toEqual([
        { table: "contact", from: "workspace_id", to: "workspace_id" },
        { table: "contact", from: "contact_id", to: "id" },
      ]);
      const interactionCompanyForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('interaction') where \"table\" = 'company' order by seq",
        )
        .all();
      expect(interactionCompanyForeignKeys).toEqual([
        { table: "company", from: "workspace_id", to: "workspace_id" },
        { table: "company", from: "company_id", to: "id" },
      ]);
      const interactionOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('interaction') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(interactionOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);

      const opportunityColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('opportunity') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(opportunityColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "company_id",
        "role",
        "job_id",
        "url",
        "location",
        "work_mode",
        "employment_type",
        "experience_requirement",
        "source",
        "discovered_on",
        "posted_on",
        "deadline_on",
        "compensation",
        "priority",
        "interest_score",
        "eligibility",
        "referral_preferred",
        "resume_version_id",
        "jd_snapshot",
        "notes",
        "tags_json",
        "bucket",
        "stage",
        "next_action",
        "created_at",
      ]);
      expect(
        opportunityColumns.find((column) => column.name === "bucket")
          ?.dflt_value,
      ).toBe("'saved'");
      expect(
        opportunityColumns.find((column) => column.name === "stage")
          ?.dflt_value,
      ).toBe("'discovered'");
      expect(
        opportunityColumns.find(
          (column) => column.name === "referral_preferred",
        )?.dflt_value,
      ).toBe("false");
      expect(
        opportunityColumns.find((column) => column.name === "tags_json")
          ?.dflt_value,
      ).toBe("'[]'");

      const opportunityCompanyForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('opportunity') where \"table\" = 'company' order by seq",
        )
        .all();
      expect(opportunityCompanyForeignKeys).toEqual([
        { table: "company", from: "workspace_id", to: "workspace_id" },
        { table: "company", from: "company_id", to: "id" },
      ]);

      const opportunityContactColumns = client.sqlite
        .prepare(
          "select name, \"notnull\" from pragma_table_info('opportunity_contact') order by cid",
        )
        .all() as { name: string; notnull: number }[];
      expect(opportunityContactColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "opportunity_id",
        "contact_id",
        "created_at",
      ]);
      expect(
        opportunityContactColumns.every((column) => column.notnull === 1),
      ).toBe(true);

      const opportunityContactOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('opportunity_contact') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(opportunityContactOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);
      const opportunityContactContactForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('opportunity_contact') where \"table\" = 'contact' order by seq",
        )
        .all();
      expect(opportunityContactContactForeignKeys).toEqual([
        { table: "contact", from: "workspace_id", to: "workspace_id" },
        { table: "contact", from: "contact_id", to: "id" },
      ]);

      const applicationColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('application') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(applicationColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "opportunity_id",
        "portal",
        "applied_on",
        "application_external_id",
        "referrer",
        "resume_version_id",
        "stage",
        "notes",
        "created_at",
      ]);
      expect(
        applicationColumns.find((column) => column.name === "stage")
          ?.dflt_value,
      ).toBe("'applied'");
      expect(
        applicationColumns.find((column) => column.name === "resume_version_id")
          ?.notnull,
      ).toBe(0);

      const applicationOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('application') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(applicationOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);

      const referralColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('referral_request') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(referralColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "contact_id",
        "opportunity_id",
        "requested_on",
        "channel",
        "resume_shared",
        "job_id_shared",
        "job_url_shared",
        "stage",
        "follow_up_on",
        "received_on",
        "confirmation",
        "next_action",
        "notes",
        "created_at",
      ]);
      expect(
        referralColumns.find((column) => column.name === "contact_id")?.notnull,
      ).toBe(1);
      expect(
        referralColumns.find((column) => column.name === "opportunity_id")
          ?.notnull,
      ).toBe(0);
      expect(
        referralColumns.find((column) => column.name === "stage")?.dflt_value,
      ).toBe("'potential_contact'");

      const referralContactForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('referral_request') where \"table\" = 'contact' order by seq",
        )
        .all();
      expect(referralContactForeignKeys).toEqual([
        { table: "contact", from: "workspace_id", to: "workspace_id" },
        { table: "contact", from: "contact_id", to: "id" },
      ]);
      const referralOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('referral_request') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(referralOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);

      const interactionReferralForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('interaction') where \"table\" = 'referral_request' order by seq",
        )
        .all();
      expect(interactionReferralForeignKeys).toEqual([
        { table: "referral_request", from: "workspace_id", to: "workspace_id" },
        { table: "referral_request", from: "referral_id", to: "id" },
      ]);
    } finally {
      client.close();
    }
  });
});
