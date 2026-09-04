import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
          "email_account",
          "email_template",
          "email_thread",
          "email_message",
          "email_sequence",
          "gmail_recovery_generation",
          "gmail_recovery_thread",
          "send_queue",
          "sequence_enrollment",
          "sequence_step",
          "suppression_entry",
          "bounce_event",
        ]),
      );
      expect(
        client.sqlite
          .prepare("select count(*) as count from __drizzle_migrations")
          .get(),
      ).toEqual({ count: 30 });

      const accountColumns = client.sqlite
        .prepare("select name from pragma_table_info('user_account') order by cid")
        .all() as { name: string }[];
      expect(accountColumns.map((column) => column.name)).toEqual([
        "id",
        "username_normalized",
        "password_hash",
        "email_verified_at",
        "status",
        "created_at",
        "updated_at",
        "totp_secret_blob",
        "totp_enabled_at",
        "totp_last_used_counter",
        "signup_completed_at",
      ]);

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
        "interaction_workspace_email_message_unique",
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
        "email_account_workspace_id_id_unique",
        "email_account_workspace_google_sub_unique",
        "email_account_workspace_status_idx",
        "email_template_workspace_id_id_unique",
        "email_template_workspace_title_unique",
        "email_thread_workspace_id_id_unique",
        "email_thread_workspace_account_idx",
        "email_thread_workspace_id_account_unique",
        "email_thread_workspace_last_message_idx",
        "email_message_workspace_id_id_unique",
        "email_message_workspace_thread_idx",
        "email_message_workspace_account_sent_idx",
        "email_sequence_workspace_id_id_unique",
        "email_sequence_workspace_name_unique",
        "sequence_step_workspace_id_id_unique",
        "sequence_step_workspace_sequence_offset_unique",
        "sequence_step_workspace_sequence_idx",
        "sequence_enrollment_workspace_id_id_unique",
        "sequence_enrollment_workspace_status_next_idx",
        "sequence_enrollment_workspace_contact_idx",
        "sequence_enrollment_workspace_account_idx",
        "sequence_enrollment_workspace_sequence_contact_idx",
        "send_queue_workspace_status_send_idx",
        "send_queue_workspace_account_sent_idx",
        "send_queue_workspace_enrollment_step_unique",
        "suppression_entry_workspace_email_idx",
        "suppression_entry_workspace_source_unique",
      ]) {
        const columns = client.sqlite
          .prepare(
            "select name from pragma_index_info(?) order by seqno",
          )
          .all(indexName) as { name: string }[];
        expect(columns[0]?.name, indexName).toBe("workspace_id");
      }

      const queueColumns = client.sqlite
        .prepare("select name from pragma_table_info('send_queue') order by cid")
        .all() as { name: string }[];
      expect(queueColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "account_id",
        "contact_id",
        "opportunity_id",
        "referral_id",
        "enrollment_id",
        "step_id",
        "origin",
        "status",
        "recipient",
        "subject",
        "body",
        "attachment_version_ids_json",
        "send_at",
        "payload_hash",
        "approval_hash",
        "approved_at",
        "approval_kind",
        "message_id",
        "claimed_at",
        "attempts",
        "last_error",
        "gmail_message_id",
        "gmail_thread_id",
        "sent_at",
        "created_at",
        "updated_at",
      ]);

      const suppressionColumns = client.sqlite
        .prepare("select name from pragma_table_info('suppression_entry') order by cid")
        .all() as { name: string }[];
      expect(suppressionColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "email",
        "reason",
        "source_key",
        "at",
      ]);

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
        "invalid_at",
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
      expect(settingsColumns.map((column) => column.name)).toContain(
        "default_email_account_id",
      );
      expect(settingsColumns.map((column) => column.name)).toContain(
        "contact_cooldown_days",
      );
      expect(settingsColumns.map((column) => column.name)).toContain(
        "max_outreach_per_opportunity",
      );

      const bounceEventColumns = client.sqlite
        .prepare("select name from pragma_table_info('bounce_event') order by cid")
        .all() as { name: string }[];
      expect(bounceEventColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "account_id",
        "email",
        "gmail_message_id",
        "kind",
        "smtp_status",
        "diagnostic",
        "at",
      ]);

      const emailAccountColumns = client.sqlite
        .prepare(
          "select name, \"notnull\", dflt_value from pragma_table_info('email_account') order by cid",
        )
        .all() as {
        name: string;
        notnull: number;
        dflt_value: string | null;
      }[];
      expect(emailAccountColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "google_sub",
        "email_normalized",
        "token_blob",
        "sender_name",
        "signature",
        "reply_to",
        "daily_limit",
        "sending_window_start",
        "sending_window_end",
        "status",
        "last_history_id",
        "last_sync_at",
        "sequence_safe_at",
        "created_at",
        "updated_at",
        "last_sync_error",
        "message_id_verified_at",
      ]);
      expect(
        emailAccountColumns.find((column) => column.name === "token_blob")
          ?.notnull,
      ).toBe(1);
      expect(
        emailAccountColumns.find((column) => column.name === "daily_limit")
          ?.dflt_value,
      ).toBe("40");

      const settingsEmailAccountForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('settings') where \"table\" = 'email_account' order by seq",
        )
        .all();
      expect(settingsEmailAccountForeignKeys).toEqual([
        {
          table: "email_account",
          from: "workspace_id",
          to: "workspace_id",
        },
        {
          table: "email_account",
          from: "default_email_account_id",
          to: "id",
        },
      ]);

      const emailTemplateColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('email_template') order by cid",
        )
        .all() as { name: string }[];
      expect(emailTemplateColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "title",
        "subject",
        "body",
        "variables_json",
        "default_email_account_id",
        "default_document_version_id",
        "default_follow_up_days",
        "tags_json",
        "created_at",
        "updated_at",
      ]);

      const emailThreadColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('email_thread') order by cid",
        )
        .all() as { name: string }[];
      expect(emailThreadColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "account_id",
        "gmail_thread_id",
        "subject",
        "contact_id",
        "company_id",
        "opportunity_id",
        "referral_id",
        "source",
        "match_status",
        "match_reason",
        "suggested_contact_ids_json",
        "last_message_at",
        "created_at",
        "updated_at",
      ]);

      const emailMessageColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('email_message') order by cid",
        )
        .all() as { name: string }[];
      expect(emailMessageColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "thread_id",
        "account_id",
        "gmail_id",
        "rfc_message_id",
        "direction",
        "from_email",
        "to_json",
        "subject",
        "body",
        "attachment_version_ids_json",
        "classification",
        "sent_at",
        "created_at",
      ]);

      const sequenceColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('email_sequence') order by cid",
        )
        .all() as { name: string }[];
      expect(sequenceColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "name",
        "created_at",
        "updated_at",
      ]);

      const sequenceStepColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('sequence_step') order by cid",
        )
        .all() as { name: string }[];
      expect(sequenceStepColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "sequence_id",
        "offset_days",
        "template_id",
        "created_at",
        "updated_at",
      ]);

      const sequenceEnrollmentColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('sequence_enrollment') order by cid",
        )
        .all() as { name: string }[];
      expect(sequenceEnrollmentColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "sequence_id",
        "contact_id",
        "opportunity_id",
        "account_id",
        "current_step_id",
        "thread_id",
        "status",
        "cancel_reason",
        "next_at",
        "thread_proven_at",
        "enrolled_at",
        "created_at",
        "updated_at",
      ]);

      const recoveryGenerationColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('gmail_recovery_generation') order by cid",
        )
        .all() as { name: string }[];
      expect(recoveryGenerationColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "account_id",
        "baseline_history_id",
        "status",
        "catch_up_page_token",
        "deferred_thread",
        "lease_owner",
        "lease_expires_at",
        "next_retry_at",
        "created_at",
        "updated_at",
        "completed_at",
      ]);

      const recoveryThreadColumns = client.sqlite
        .prepare(
          "select name from pragma_table_info('gmail_recovery_thread') order by cid",
        )
        .all() as { name: string }[];
      expect(recoveryThreadColumns.map((column) => column.name)).toEqual([
        "id",
        "workspace_id",
        "generation_id",
        "account_id",
        "gmail_thread_id",
        "status",
        "created_at",
        "reconciled_at",
      ]);

      const templateAccountForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('email_template') where \"table\" = 'email_account' order by seq",
        )
        .all();
      expect(templateAccountForeignKeys).toEqual([
        {
          table: "email_account",
          from: "workspace_id",
          to: "workspace_id",
        },
        {
          table: "email_account",
          from: "default_email_account_id",
          to: "id",
        },
      ]);

      const threadAccountForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('email_thread') where \"table\" = 'email_account' order by seq",
        )
        .all();
      expect(threadAccountForeignKeys).toEqual([
        {
          table: "email_account",
          from: "workspace_id",
          to: "workspace_id",
        },
        { table: "email_account", from: "account_id", to: "id" },
      ]);

      const messageThreadForeignKeys = client.sqlite
        .prepare(
          "select \"table\", \"from\", \"to\" from pragma_foreign_key_list('email_message') where \"table\" = 'email_thread' order by seq",
        )
        .all();
      expect(messageThreadForeignKeys).toEqual([
        {
          table: "email_thread",
          from: "workspace_id",
          to: "workspace_id",
        },
        { table: "email_thread", from: "thread_id", to: "id" },
        {
          table: "email_thread",
          from: "account_id",
          to: "account_id",
        },
      ]);

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

  it("backfills existing Do Not Contact email methods into suppression", () => {
    const directory = mkdtempSync(join(tmpdir(), "job-pilot-backfill-"));
    temporaryDirectories.push(directory);
    const priorMigrations = join(directory, "prior-migrations");
    cpSync(resolve(process.cwd(), "drizzle"), priorMigrations, {
      recursive: true,
    });
    rmSync(join(priorMigrations, "0023_send_safety.sql"));
    rmSync(join(priorMigrations, "meta", "0023_snapshot.json"));
    const journalPath = join(priorMigrations, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < 23);
    writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);

    const databasePath = join(directory, "backfill.sqlite");
    migrateDatabase(databasePath, { migrationsFolder: priorMigrations });
    const prior = openDatabase(databasePath);
    try {
      prior.sqlite.exec(`
        insert into user_account (id, email_normalized, password_hash, status, created_at, updated_at)
        values ('user-a', 'owner@invalid.test', 'hash', 'active', 1, 1);
        insert into workspace (id, owner_user_id, created_at)
        values ('workspace-a', 'user-a', 1);
        insert into settings (workspace_id, display_name, timezone)
        values ('workspace-a', 'Owner', 'Asia/Kolkata');
        insert into contact (id, workspace_id, name, networking_status, created_at)
        values ('contact-a', 'workspace-a', 'Blocked', 'do_not_contact', 2);
        insert into contact_method (id, workspace_id, contact_id, kind, value, value_normalized, is_primary, created_at)
        values ('method-a', 'workspace-a', 'contact-a', 'email', 'Blocked@Invalid.Test', 'blocked@invalid.test', 1, 3);
      `);
    } finally {
      prior.close();
    }

    migrateDatabase(databasePath);
    const migrated = openDatabase(databasePath);
    try {
      expect(
        migrated.sqlite.prepare(
          "select workspace_id, email, reason, source_key from suppression_entry",
        ).all(),
      ).toEqual([
        {
          workspace_id: "workspace-a",
          email: "blocked@invalid.test",
          reason: "do_not_contact",
          source_key: "contact:contact-a",
        },
      ]);
    } finally {
      migrated.close();
    }
  });

  it("preserves a grandfathered account while renaming identity and adding TOTP", () => {
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
      client.sqlite.exec(
        readFileSync(resolve("drizzle/0026_username_totp.sql"), "utf8"),
      );
      client.sqlite.exec(
        readFileSync(resolve("drizzle/0027_mandatory_totp_signup.sql"), "utf8"),
      );

      expect(
        client.sqlite
          .prepare(
            `select username_normalized, totp_secret_blob, totp_enabled_at,
                    totp_last_used_counter, signup_completed_at
             from user_account where id = 'legacy-user'`,
          )
          .get(),
      ).toEqual({
        username_normalized: "legacy@invalid.test",
        totp_secret_blob: null,
        totp_enabled_at: null,
        totp_last_used_counter: null,
        signup_completed_at: createdAt,
      });
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
