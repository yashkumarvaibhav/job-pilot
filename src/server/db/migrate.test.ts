import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
          "import_mapping",
          "opportunity",
          "opportunity_contact",
          "application",
          "referral_request",
          "settings",
          "tag",
          "entity_tag",
          "task",
          "user_account",
          "workspace",
          "notification",
          "interview",
          "assessment",
          "document",
          "document_version",
          "document_usage",
          "saved_search",
          "automation_rule",
          "automation_execution",
        ]),
      );
      expect(
        client.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 19 });

      for (const indexName of [
        "company_workspace_id_id_unique",
        "company_workspace_name_idx",
        "company_workspace_next_action_due_idx",
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
        "import_mapping_workspace_idx",
        "opportunity_workspace_id_id_unique",
        "opportunity_workspace_company_idx",
        "opportunity_workspace_bucket_idx",
        "opportunity_workspace_stage_idx",
        "opportunity_workspace_deadline_idx",
        "opportunity_workspace_next_action_due_idx",
        "opportunity_workspace_company_job_id_idx",
        "opportunity_contact_workspace_id_id_unique",
        "opportunity_contact_workspace_pair_unique",
        "opportunity_contact_workspace_opportunity_idx",
        "opportunity_contact_workspace_contact_idx",
        "application_workspace_id_id_unique",
        "application_workspace_opportunity_unique",
        "application_workspace_stage_idx",
        "application_workspace_applied_on_idx",
        "application_workspace_offer_deadline_idx",
        "referral_request_workspace_id_id_unique",
        "referral_request_workspace_contact_idx",
        "referral_request_workspace_opportunity_idx",
        "referral_request_workspace_stage_idx",
        "referral_request_workspace_requested_on_idx",
        "referral_request_workspace_follow_up_idx",
        "task_workspace_id_id_unique",
        "task_workspace_status_idx",
        "task_workspace_due_idx",
        "task_workspace_derived_from_key_idx",
        "task_workspace_entity_idx",
        "settings_workspace_idx",
        "document_workspace_id_id_unique",
        "document_workspace_name_unique",
        "document_workspace_kind_idx",
        "document_version_workspace_id_id_unique",
        "document_version_workspace_label_unique",
        "document_version_workspace_document_idx",
        "document_usage_workspace_id_id_unique",
        "document_usage_workspace_link_unique",
        "document_usage_workspace_version_idx",
        "document_usage_workspace_entity_idx",
        "activity_event_workspace_id_id_unique",
        "activity_event_workspace_at_idx",
        "activity_event_workspace_entity_idx",
        "tag_workspace_id_id_unique",
        "tag_workspace_label_unique",
        "tag_workspace_label_idx",
        "entity_tag_workspace_id_id_unique",
        "entity_tag_workspace_link_unique",
        "entity_tag_workspace_entity_idx",
        "entity_tag_workspace_tag_idx",
        "notification_workspace_id_id_unique",
        "notification_workspace_due_key_unique",
        "notification_workspace_due_on_idx",
        "notification_workspace_group_key_idx",
        "notification_workspace_kind_idx",
        "notification_workspace_snoozed_idx",
        "interview_workspace_id_id_unique",
        "interview_workspace_opportunity_round_unique",
        "interview_workspace_opportunity_idx",
        "interview_workspace_at_idx",
        "assessment_workspace_id_id_unique",
        "assessment_workspace_opportunity_idx",
        "assessment_workspace_application_idx",
        "assessment_workspace_due_idx",
        "saved_search_workspace_id_id_unique",
        "saved_search_workspace_name_unique",
        "saved_search_workspace_entity_idx",
        "automation_rule_workspace_id_id_unique",
        "automation_rule_workspace_slug_unique",
        "automation_execution_workspace_id_id_unique",
        "automation_execution_workspace_rule_idx",
        "automation_execution_workspace_at_idx",
      ]) {
        const columns = client.sqlite
          .prepare(
            "select name from pragma_index_info(?) order by seqno",
          )
          .all(indexName) as { name: string }[];
        expect(columns[0]?.name, indexName).toBe("workspace_id");
      }

      // Deliberately NOT workspace-first: one stored file may back exactly one
      // version row anywhere in the database, so a key collision across two
      // workspaces is impossible rather than merely unlikely.
      const storageKeyIndex = client.sqlite
        .prepare("select name from pragma_index_info('document_version_storage_key_unique')")
        .all() as { name: string }[];
      expect(storageKeyIndex.map((column) => column.name)).toEqual([
        "storage_key",
      ]);
      expect(
        client.sqlite
          .prepare(
            "select \"unique\" from pragma_index_list('document_version') where name = 'document_version_storage_key_unique'",
          )
          .get(),
      ).toEqual({ unique: 1 });

      expect(
        client.sqlite
          .prepare(
            "select \"unique\" from pragma_index_list('opportunity') where name = 'opportunity_workspace_company_job_id_idx'",
          )
          .get(),
      ).toEqual({ unique: 0 });

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
        "next_action",
        "next_action_due",
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
        "next_action_due",
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
        "offer_deadline_on",
        "offer_decision",
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

      const interviewColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('interview') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(interviewColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "opportunity_id",
        "round_index",
        "kind",
        "at",
        "meeting_url",
        "interviewer",
        "questions",
        "prep_notes",
        "performance",
        "result",
        "notes",
        "created_at",
      ]);
      expect(
        interviewColumns.find((column) => column.name === "at")?.notnull,
      ).toBe(0);
      expect(
        interviewColumns.find((column) => column.name === "round_index")
          ?.notnull,
      ).toBe(1);

      const interviewOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('interview') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(interviewOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);

      const assessmentColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('assessment') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(assessmentColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "opportunity_id",
        "application_id",
        "kind",
        "platform",
        "invited_at",
        "window_opens_at",
        "due_at",
        "duration_minutes",
        "status",
        "result",
        "notes",
        "created_at",
      ]);
      expect(
        assessmentColumns.find((column) => column.name === "opportunity_id")
          ?.notnull,
      ).toBe(1);
      expect(
        assessmentColumns.find((column) => column.name === "application_id")
          ?.notnull,
      ).toBe(0);
      expect(
        assessmentColumns.find((column) => column.name === "status")
          ?.dflt_value,
      ).toBe("'invited'");

      const assessmentOpportunityForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('assessment') where \"table\" = 'opportunity' order by seq",
        )
        .all();
      expect(assessmentOpportunityForeignKeys).toEqual([
        { table: "opportunity", from: "workspace_id", to: "workspace_id" },
        { table: "opportunity", from: "opportunity_id", to: "id" },
      ]);
      const assessmentApplicationForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('assessment') where \"table\" = 'application' order by seq",
        )
        .all();
      expect(assessmentApplicationForeignKeys).toEqual([
        { table: "application", from: "workspace_id", to: "workspace_id" },
        { table: "application", from: "application_id", to: "id" },
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

      const taskColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('task') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(taskColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "title",
        "description",
        "due_on",
        "priority",
        "status",
        "source",
        "entity_type",
        "entity_id",
        "derived_from_key",
        "created_by_rule",
        "completed_at",
        "created_at",
      ]);
      expect(
        taskColumns.find((column) => column.name === "status")?.dflt_value,
      ).toBe("'open'");
      expect(
        taskColumns.find((column) => column.name === "priority")?.dflt_value,
      ).toBe("'medium'");
      expect(
        taskColumns.find((column) => column.name === "source")?.dflt_value,
      ).toBe("'manual'");
      expect(
        taskColumns.find((column) => column.name === "title")?.notnull,
      ).toBe(1);
      expect(
        taskColumns.find((column) => column.name === "entity_id")?.notnull,
      ).toBe(0);
      const taskForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('task')",
        )
        .all();
      expect(taskForeignKeys).toContainEqual({
        table: "workspace",
        from: "workspace_id",
        to: "id",
      });

      const tagColumns = client.sqlite
        .prepare(
          "select name, \"notnull\" from pragma_table_info('tag') order by cid",
        )
        .all() as { name: string; notnull: number }[];
      expect(tagColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "label",
        "label_normalized",
        "created_at",
      ]);
      expect(tagColumns.every((column) => column.notnull === 1)).toBe(true);

      const entityTagColumns = client.sqlite
        .prepare(
          "select name, \"notnull\" from pragma_table_info('entity_tag') order by cid",
        )
        .all() as { name: string; notnull: number }[];
      expect(entityTagColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "tag_id",
        "entity_type",
        "entity_id",
        "created_at",
      ]);
      const entityTagTagForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('entity_tag') where \"table\" = 'tag' order by seq",
        )
        .all();
      expect(entityTagTagForeignKeys).toEqual([
        { table: "tag", from: "workspace_id", to: "workspace_id" },
        { table: "tag", from: "tag_id", to: "id" },
      ]);

      const settingsColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('settings') order by cid",
        )
        .all() as { name: string }[];
      expect(settingsColumns.map((column) => column.name)).toContain(
        "muted_notification_kinds_json",
      );

      const notificationColumns = client.sqlite
        .prepare(
          "select name, \"notnull\" from pragma_table_info('notification') order by cid",
        )
        .all() as { name: string; notnull: number }[];
      expect(notificationColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "kind",
        "entity_type",
        "entity_id",
        "title",
        "body",
        "due_on",
        "due_at",
        "due_key",
        "group_key",
        "read_at",
        "snoozed_until",
        "dismissed_at",
        "completed_at",
        "created_at",
      ]);
      expect(
        notificationColumns.find((column) => column.name === "due_key")
          ?.notnull,
      ).toBe(1);
      expect(
        notificationColumns.find((column) => column.name === "snoozed_until")
          ?.notnull,
      ).toBe(0);
      const notificationForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('notification')",
        )
        .all();
      expect(notificationForeignKeys).toContainEqual({
        table: "workspace",
        from: "workspace_id",
        to: "id",
      });

      const automationRuleColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('automation_rule') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(automationRuleColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "slug",
        "enabled",
        "spec_json",
        "created_at",
      ]);
      expect(
        automationRuleColumns.find((column) => column.name === "enabled")
          ?.dflt_value,
      ).toBe("true");
      expect(
        automationRuleColumns.find((column) => column.name === "slug")?.notnull,
      ).toBe(1);

      const automationExecutionColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('automation_execution') order by cid",
        )
        .all() as { name: string }[];
      expect(automationExecutionColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "rule_id",
        "at",
        "input_json",
        "result_json",
      ]);
      const automationExecutionRuleForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('automation_execution') where \"table\" = 'automation_rule' order by seq",
        )
        .all();
      expect(automationExecutionRuleForeignKeys).toEqual([
        {
          table: "automation_rule",
          from: "workspace_id",
          to: "workspace_id",
        },
        { table: "automation_rule", from: "rule_id", to: "id" },
      ]);
    } finally {
      client.close();
    }
  });

  it("grandfathers accounts created before verification delivery existed", () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-backfill-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "legacy.sqlite");
    const client = openDatabase(databasePath);

    try {
      client.sqlite.exec(
        readFileSync(resolve("drizzle/0000_flawless_hydra.sql"), "utf8"),
      );
      const createdAt = Date.parse("2026-09-01T09:00:00.000Z");
      client.sqlite
        .prepare(
          `insert into user_account
            (id, email_normalized, password_hash, status, created_at, updated_at)
           values ('legacy-user', 'legacy@invalid.test', 'hash', 'active', ?, ?)`,
        )
        .run(createdAt, createdAt);

      client.sqlite.exec(
        readFileSync(
          resolve("drizzle/0016_account_verification_backfill.sql"),
          "utf8",
        ),
      );

      expect(
        client.sqlite
          .prepare(
            "select email_verified_at from user_account where id = 'legacy-user'",
          )
          .get(),
      ).toEqual({ email_verified_at: createdAt });
    } finally {
      client.close();
    }
  });

  it("satisfies the backup document contract the moment the table lands", async () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-migrate-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "test.sqlite");
    migrateDatabase(databasePath);

    // D-026: backup verification turns itself on when document_version appears.
    // If this throws, the migration broke the (id, storage_key, sha256) contract.
    const { readDocumentEntries } = await import(
      "../../../scripts/backup/documents.mjs"
    );
    const client = openDatabase(databasePath);
    try {
      const result = readDocumentEntries(client.sqlite);
      expect(result.present).toBe(true);
      expect(result.entries).toEqual([]);
    } finally {
      client.close();
    }
  });
});
