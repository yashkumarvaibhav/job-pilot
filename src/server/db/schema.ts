import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
  DEFAULT_NETWORKING_STATUS,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "../../domain/contact";
import type {
  InteractionChannel,
  InteractionDirection,
} from "../../domain/interaction";
import {
  DEFAULT_APPLICATION_STAGE,
  type ApplicationStage,
} from "../../domain/application";
import {
  DEFAULT_OPPORTUNITY_BUCKET,
  DEFAULT_OPPORTUNITY_STAGE,
  type OpportunityBucket,
  type OpportunityStage,
} from "../../domain/opportunity";
import {
  DEFAULT_REFERRAL_STAGE,
  type ReferralStage,
} from "../../domain/referral";
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_SOURCE,
  DEFAULT_TASK_STATUS,
  type TaskLinkType,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from "../../domain/task";
import { DEFAULT_TIME_ZONE } from "./timezone";

const utcInstant = (name: string) => integer(name, { mode: "timestamp_ms" });

export const userAccount = sqliteTable("user_account", {
  id: text("id").primaryKey(),
  emailNormalized: text("email_normalized").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: utcInstant("email_verified_at"),
  status: text("status").notNull().default("active"),
  createdAt: utcInstant("created_at").notNull(),
  updatedAt: utcInstant("updated_at").notNull(),
});

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "cascade" }),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("workspace_owner_user_id_unique").on(table.ownerUserId),
  ],
);

type WorkspaceEntityColumns = {
  id: AnySQLiteColumn;
  workspaceId: AnySQLiteColumn;
};

export function workspaceOwnedEntityColumns() {
  return {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
  };
}

export function workspaceEntityKey(
  tableName: string,
  columns: WorkspaceEntityColumns,
) {
  return uniqueIndex(`${tableName}_workspace_id_id_unique`).on(
    columns.workspaceId,
    columns.id,
  );
}

export function sameWorkspaceForeignKey(
  name: string,
  child: { workspaceId: AnySQLiteColumn; parentId: AnySQLiteColumn },
  parent: WorkspaceEntityColumns,
) {
  return foreignKey({
    name,
    columns: [child.workspaceId, child.parentId],
    foreignColumns: [parent.workspaceId, parent.id],
  });
}

export const settings = sqliteTable(
  "settings",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull().default(""),
    university: text("university"),
    timezone: text("timezone").notNull().default(DEFAULT_TIME_ZONE),
    scoringWeightsJson: text("scoring_weights_json", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'`),
    mutedNotificationKindsJson: text("muted_notification_kinds_json", {
      mode: "json",
    })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    quietStart: integer("quiet_start"),
    quietEnd: integer("quiet_end"),
    digestHour: integer("digest_hour"),
  },
  (table) => [
    index("settings_workspace_idx").on(table.workspaceId),
    check(
      "settings_timezone_not_blank",
      sql`length(trim(${table.timezone})) > 0`,
    ),
    check(
      "settings_quiet_start_range",
      sql`${table.quietStart} is null or ${table.quietStart} between 0 and 1439`,
    ),
    check(
      "settings_quiet_end_range",
      sql`${table.quietEnd} is null or ${table.quietEnd} between 0 and 1439`,
    ),
    check(
      "settings_digest_hour_range",
      sql`${table.digestHour} is null or ${table.digestHour} between 0 and 23`,
    ),
  ],
);

export const importMapping = sqliteTable(
  "import_mapping",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    entitySet: text("entity_set", {
      enum: ["companies", "contacts", "opportunities"],
    }).notNull(),
    mappingJson: text("mapping_json", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull(),
    updatedAt: utcInstant("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.entitySet] }),
    index("import_mapping_workspace_idx").on(table.workspaceId),
    check(
      "import_mapping_entity_set_valid",
      sql`${table.entitySet} in ('companies', 'contacts', 'opportunities')`,
    ),
  ],
);

export const authSession = sqliteTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "cascade" }),
    tokenDigest: text("token_digest").notNull().unique(),
    createdAt: utcInstant("created_at").notNull(),
    lastSeenAt: utcInstant("last_seen_at").notNull(),
    idleExpiresAt: utcInstant("idle_expires_at").notNull(),
    absoluteExpiresAt: utcInstant("absolute_expires_at").notNull(),
    revokedAt: utcInstant("revoked_at"),
  },
  (table) => [
    index("auth_session_user_id_idx").on(table.userId),
    index("auth_session_user_expiry_idx").on(
      table.userId,
      table.idleExpiresAt,
      table.absoluteExpiresAt,
    ),
  ],
);

export const accountToken = sqliteTable(
  "account_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userAccount.id, { onDelete: "cascade" }),
    purpose: text("purpose", {
      enum: ["verify_email", "reset_password"],
    }).notNull(),
    tokenDigest: text("token_digest").notNull().unique(),
    expiresAt: utcInstant("expires_at").notNull(),
    usedAt: utcInstant("used_at"),
  },
  (table) => [
    index("account_token_user_purpose_idx").on(table.userId, table.purpose),
    check(
      "account_token_purpose_valid",
      sql`${table.purpose} in ('verify_email', 'reset_password')`,
    ),
  ],
);

export const activityEvent = sqliteTable(
  "activity_event",
  {
    ...workspaceOwnedEntityColumns(),
    at: utcInstant("at").notNull(),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    payloadJson: text("payload_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    workspaceEntityKey("activity_event", table),
    index("activity_event_workspace_at_idx").on(table.workspaceId, table.at),
    index("activity_event_workspace_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const company = sqliteTable(
  "company",
  {
    ...workspaceOwnedEntityColumns(),
    name: text("name").notNull(),
    website: text("website"),
    careersUrl: text("careers_url"),
    industry: text("industry"),
    type: text("type"),
    locations: text("locations"),
    target: integer("target", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    nextAction: text("next_action"),
    nextActionDue: text("next_action_due"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("company", table),
    index("company_workspace_name_idx").on(table.workspaceId, table.name),
    index("company_workspace_next_action_due_idx").on(
      table.workspaceId,
      table.nextActionDue,
    ),
    check("company_name_not_blank", sql`length(trim(${table.name})) > 0`),
  ],
);

export const contact = sqliteTable(
  "contact",
  {
    ...workspaceOwnedEntityColumns(),
    companyId: text("company_id"),
    name: text("name").notNull(),
    designation: text("designation"),
    relationship: text("relationship")
      .$type<ContactRelationship>()
      .notNull()
      .default("unknown_cold_contact"),
    source: text("source"),
    location: text("location"),
    notes: text("notes"),
    tagsJson: text("tags_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    preferredContactChannel: text("preferred_contact_channel").$type<
      ContactMethodKind | null
    >(),
    networkingStatus: text("networking_status")
      .$type<NetworkingStatus>()
      .notNull()
      .default(DEFAULT_NETWORKING_STATUS),
    lastInteractionAt: utcInstant("last_interaction_at"),
    nextAction: text("next_action"),
    followUpOn: text("follow_up_on"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("contact", table),
    index("contact_workspace_name_idx").on(table.workspaceId, table.name),
    index("contact_workspace_company_idx").on(
      table.workspaceId,
      table.companyId,
    ),
    index("contact_workspace_status_idx").on(
      table.workspaceId,
      table.networkingStatus,
    ),
    index("contact_workspace_follow_up_idx").on(
      table.workspaceId,
      table.followUpOn,
    ),
    sameWorkspaceForeignKey(
      "contact_company_fk",
      { workspaceId: table.workspaceId, parentId: table.companyId },
      company,
    ),
    check("contact_name_not_blank", sql`length(trim(${table.name})) > 0`),
    check(
      "contact_relationship_valid",
      sql`${table.relationship} in ('friend', 'college_friend', 'alumni', 'employee', 'recruiter', 'hiring_manager', 'former_employee', 'mutual_connection', 'community_contact', 'unknown_cold_contact', 'other')`,
    ),
    check(
      "contact_networking_status_valid",
      sql`${table.networkingStatus} in ('not_contacted', 'ready_to_contact', 'contacted', 'waiting_for_reply', 'checking_for_openings', 'follow_up_later', 'opening_found', 'referral_discussion', 'referral_promised', 'no_openings_currently', 'keep_in_touch', 'do_not_contact', 'inactive')`,
    ),
    check(
      "contact_preferred_channel_valid",
      sql`${table.preferredContactChannel} is null or ${table.preferredContactChannel} in ('email', 'linkedin', 'phone', 'whatsapp', 'other')`,
    ),
  ],
);

export const contactMethod = sqliteTable(
  "contact_method",
  {
    ...workspaceOwnedEntityColumns(),
    contactId: text("contact_id").notNull(),
    kind: text("kind").$type<ContactMethodKind>().notNull(),
    value: text("value").notNull(),
    valueNormalized: text("value_normalized").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("contact_method", table),
    index("contact_method_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
    ),
    uniqueIndex("contact_method_workspace_kind_value_unique").on(
      table.workspaceId,
      table.kind,
      table.valueNormalized,
    ),
    sameWorkspaceForeignKey(
      "contact_method_contact_fk",
      { workspaceId: table.workspaceId, parentId: table.contactId },
      contact,
    ).onDelete("cascade"),
    check(
      "contact_method_kind_valid",
      sql`${table.kind} in ('email', 'linkedin', 'phone', 'whatsapp', 'other')`,
    ),
    check(
      "contact_method_value_not_blank",
      sql`length(trim(${table.value})) > 0 and length(trim(${table.valueNormalized})) > 0`,
    ),
  ],
);

export const opportunity = sqliteTable(
  "opportunity",
  {
    ...workspaceOwnedEntityColumns(),
    companyId: text("company_id").notNull(),
    role: text("role").notNull(),
    jobId: text("job_id"),
    url: text("url"),
    location: text("location"),
    workMode: text("work_mode"),
    employmentType: text("employment_type"),
    experienceRequirement: text("experience_requirement"),
    source: text("source"),
    discoveredOn: text("discovered_on"),
    postedOn: text("posted_on"),
    deadlineOn: text("deadline_on"),
    compensation: text("compensation"),
    priority: text("priority"),
    interestScore: integer("interest_score"),
    eligibility: text("eligibility"),
    referralPreferred: integer("referral_preferred", { mode: "boolean" })
      .notNull()
      .default(false),
    resumeVersionId: text("resume_version_id"),
    jdSnapshot: text("jd_snapshot"),
    notes: text("notes"),
    tagsJson: text("tags_json", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    bucket: text("bucket")
      .$type<OpportunityBucket>()
      .notNull()
      .default(DEFAULT_OPPORTUNITY_BUCKET),
    stage: text("stage")
      .$type<OpportunityStage>()
      .notNull()
      .default(DEFAULT_OPPORTUNITY_STAGE),
    nextAction: text("next_action"),
    nextActionDue: text("next_action_due"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("opportunity", table),
    index("opportunity_workspace_company_idx").on(
      table.workspaceId,
      table.companyId,
    ),
    index("opportunity_workspace_bucket_idx").on(
      table.workspaceId,
      table.bucket,
    ),
    index("opportunity_workspace_stage_idx").on(
      table.workspaceId,
      table.stage,
    ),
    index("opportunity_workspace_deadline_idx").on(
      table.workspaceId,
      table.deadlineOn,
    ),
    index("opportunity_workspace_next_action_due_idx").on(
      table.workspaceId,
      table.nextActionDue,
    ),
    uniqueIndex("opportunity_workspace_company_job_id_unique").on(
      table.workspaceId,
      table.companyId,
      table.jobId,
    ),
    sameWorkspaceForeignKey(
      "opportunity_company_fk",
      { workspaceId: table.workspaceId, parentId: table.companyId },
      company,
    ),
    check("opportunity_role_not_blank", sql`length(trim(${table.role})) > 0`),
    check(
      "opportunity_bucket_valid",
      sql`${table.bucket} in ('saved', 'active')`,
    ),
    check(
      "opportunity_stage_valid",
      sql`${table.stage} in ('discovered', 'saved', 'interested', 'pursuing', 'finding_contacts', 'finding_referral', 'referral_requested', 'referral_promised', 'referral_received', 'ready_to_apply', 'applied', 'ghosted', 'position_closed', 'withdrawn', 'not_eligible', 'duplicate', 'no_longer_interested', 'expired')`,
    ),
  ],
);

export const referralRequest = sqliteTable(
  "referral_request",
  {
    ...workspaceOwnedEntityColumns(),
    contactId: text("contact_id").notNull(),
    opportunityId: text("opportunity_id"),
    requestedOn: text("requested_on"),
    channel: text("channel").$type<InteractionChannel>().notNull(),
    resumeShared: integer("resume_shared", { mode: "boolean" })
      .notNull()
      .default(false),
    jobIdShared: integer("job_id_shared", { mode: "boolean" })
      .notNull()
      .default(false),
    jobUrlShared: integer("job_url_shared", { mode: "boolean" })
      .notNull()
      .default(false),
    stage: text("stage")
      .$type<ReferralStage>()
      .notNull()
      .default(DEFAULT_REFERRAL_STAGE),
    followUpOn: text("follow_up_on"),
    receivedOn: text("received_on"),
    confirmation: text("confirmation"),
    nextAction: text("next_action"),
    notes: text("notes"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("referral_request", table),
    index("referral_request_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
    ),
    index("referral_request_workspace_opportunity_idx").on(
      table.workspaceId,
      table.opportunityId,
    ),
    index("referral_request_workspace_stage_idx").on(
      table.workspaceId,
      table.stage,
    ),
    index("referral_request_workspace_requested_on_idx").on(
      table.workspaceId,
      table.requestedOn,
    ),
    index("referral_request_workspace_follow_up_idx").on(
      table.workspaceId,
      table.followUpOn,
    ),
    sameWorkspaceForeignKey(
      "referral_request_contact_fk",
      { workspaceId: table.workspaceId, parentId: table.contactId },
      contact,
    ),
    sameWorkspaceForeignKey(
      "referral_request_opportunity_fk",
      { workspaceId: table.workspaceId, parentId: table.opportunityId },
      opportunity,
    ),
    check(
      "referral_request_channel_valid",
      sql`${table.channel} in ('email', 'linkedin_dm', 'linkedin_connection_note', 'whatsapp', 'phone', 'telegram', 'slack_discord', 'company_referral_portal', 'alumni_network', 'college_network', 'in_person', 'other')`,
    ),
    check(
      "referral_request_stage_valid",
      sql`${table.stage} in ('potential_contact', 'ready_to_contact', 'requested', 'seen_acknowledged', 'asked_for_resume', 'resume_sent', 'agreed_to_refer', 'referral_promised', 'referral_submitted', 'referral_received', 'declined', 'no_response', 'expired', 'cancelled')`,
    ),
  ],
);

export const interaction = sqliteTable(
  "interaction",
  {
    ...workspaceOwnedEntityColumns(),
    contactId: text("contact_id"),
    companyId: text("company_id"),
    opportunityId: text("opportunity_id"),
    referralId: text("referral_id"),
    channel: text("channel").$type<InteractionChannel>().notNull(),
    direction: text("direction").$type<InteractionDirection>().notNull(),
    occurredAt: utcInstant("occurred_at").notNull(),
    body: text("body").notNull().default(""),
    emailMessageId: text("email_message_id"),
    requiresReply: integer("requires_reply", { mode: "boolean" })
      .notNull()
      .default(false),
    replyResolvedAt: utcInstant("reply_resolved_at"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("interaction", table),
    index("interaction_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
    ),
    index("interaction_workspace_company_idx").on(
      table.workspaceId,
      table.companyId,
    ),
    index("interaction_workspace_opportunity_idx").on(
      table.workspaceId,
      table.opportunityId,
    ),
    index("interaction_workspace_referral_idx").on(
      table.workspaceId,
      table.referralId,
    ),
    index("interaction_workspace_occurred_idx").on(
      table.workspaceId,
      table.occurredAt,
    ),
    index("interaction_workspace_need_reply_idx").on(
      table.workspaceId,
      table.requiresReply,
      table.replyResolvedAt,
    ),
    sameWorkspaceForeignKey(
      "interaction_contact_fk",
      { workspaceId: table.workspaceId, parentId: table.contactId },
      contact,
    ),
    sameWorkspaceForeignKey(
      "interaction_company_fk",
      { workspaceId: table.workspaceId, parentId: table.companyId },
      company,
    ),
    sameWorkspaceForeignKey(
      "interaction_opportunity_fk",
      { workspaceId: table.workspaceId, parentId: table.opportunityId },
      opportunity,
    ),
    sameWorkspaceForeignKey(
      "interaction_referral_fk",
      { workspaceId: table.workspaceId, parentId: table.referralId },
      referralRequest,
    ),
    check(
      "interaction_context_present",
      sql`${table.contactId} is not null or ${table.companyId} is not null or ${table.opportunityId} is not null or ${table.referralId} is not null`,
    ),
    check(
      "interaction_channel_valid",
      sql`${table.channel} in ('email', 'linkedin_dm', 'linkedin_connection_note', 'whatsapp', 'phone', 'telegram', 'slack_discord', 'company_referral_portal', 'alumni_network', 'college_network', 'in_person', 'other')`,
    ),
    check(
      "interaction_direction_valid",
      sql`${table.direction} in ('outbound', 'inbound')`,
    ),
    check(
      "interaction_requires_reply_inbound",
      sql`${table.requiresReply} = false or ${table.direction} = 'inbound'`,
    ),
  ],
);

export const opportunityContact = sqliteTable(
  "opportunity_contact",
  {
    ...workspaceOwnedEntityColumns(),
    opportunityId: text("opportunity_id").notNull(),
    contactId: text("contact_id").notNull(),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("opportunity_contact", table),
    uniqueIndex("opportunity_contact_workspace_pair_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.contactId,
    ),
    index("opportunity_contact_workspace_opportunity_idx").on(
      table.workspaceId,
      table.opportunityId,
    ),
    index("opportunity_contact_workspace_contact_idx").on(
      table.workspaceId,
      table.contactId,
    ),
    sameWorkspaceForeignKey(
      "opportunity_contact_opportunity_fk",
      { workspaceId: table.workspaceId, parentId: table.opportunityId },
      opportunity,
    ).onDelete("cascade"),
    sameWorkspaceForeignKey(
      "opportunity_contact_contact_fk",
      { workspaceId: table.workspaceId, parentId: table.contactId },
      contact,
    ).onDelete("cascade"),
  ],
);

export const application = sqliteTable(
  "application",
  {
    ...workspaceOwnedEntityColumns(),
    opportunityId: text("opportunity_id").notNull(),
    portal: text("portal").notNull(),
    appliedOn: text("applied_on").notNull(),
    applicationExternalId: text("application_external_id"),
    referrer: text("referrer"),
    resumeVersionId: text("resume_version_id"),
    stage: text("stage")
      .$type<ApplicationStage>()
      .notNull()
      .default(DEFAULT_APPLICATION_STAGE),
    notes: text("notes"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("application", table),
    uniqueIndex("application_workspace_opportunity_unique").on(
      table.workspaceId,
      table.opportunityId,
    ),
    index("application_workspace_stage_idx").on(
      table.workspaceId,
      table.stage,
    ),
    index("application_workspace_applied_on_idx").on(
      table.workspaceId,
      table.appliedOn,
    ),
    sameWorkspaceForeignKey(
      "application_opportunity_fk",
      { workspaceId: table.workspaceId, parentId: table.opportunityId },
      opportunity,
    ).onDelete("cascade"),
    check("application_portal_not_blank", sql`length(trim(${table.portal})) > 0`),
    check(
      "application_stage_valid",
      sql`${table.stage} in ('applied', 'application_confirmed', 'under_review', 'oa_received', 'oa_completed', 'interview_scheduled', 'interview_round_1', 'interview_round_2', 'hiring_manager', 'hr', 'offer', 'rejected', 'withdrawn', 'ghosted')`,
    ),
  ],
);

export const interview = sqliteTable(
  "interview",
  {
    ...workspaceOwnedEntityColumns(),
    opportunityId: text("opportunity_id").notNull(),
    roundIndex: integer("round_index").notNull(),
    kind: text("kind").notNull(),
    at: utcInstant("at"),
    meetingUrl: text("meeting_url"),
    interviewer: text("interviewer"),
    questions: text("questions"),
    prepNotes: text("prep_notes"),
    performance: text("performance"),
    result: text("result"),
    notes: text("notes"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("interview", table),
    uniqueIndex("interview_workspace_opportunity_round_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.roundIndex,
    ),
    index("interview_workspace_opportunity_idx").on(
      table.workspaceId,
      table.opportunityId,
    ),
    index("interview_workspace_at_idx").on(table.workspaceId, table.at),
    sameWorkspaceForeignKey(
      "interview_opportunity_fk",
      { workspaceId: table.workspaceId, parentId: table.opportunityId },
      opportunity,
    ).onDelete("cascade"),
    check("interview_kind_not_blank", sql`length(trim(${table.kind})) > 0`),
    check("interview_round_index_positive", sql`${table.roundIndex} >= 1`),
  ],
);

export const task = sqliteTable(
  "task",
  {
    ...workspaceOwnedEntityColumns(),
    title: text("title").notNull(),
    description: text("description"),
    dueOn: text("due_on"),
    priority: text("priority")
      .$type<TaskPriority>()
      .notNull()
      .default(DEFAULT_TASK_PRIORITY),
    status: text("status")
      .$type<TaskStatus>()
      .notNull()
      .default(DEFAULT_TASK_STATUS),
    source: text("source")
      .$type<TaskSource>()
      .notNull()
      .default(DEFAULT_TASK_SOURCE),
    entityType: text("entity_type").$type<TaskLinkType | null>(),
    entityId: text("entity_id"),
    derivedFromKey: text("derived_from_key"),
    createdByRule: integer("created_by_rule", { mode: "boolean" })
      .notNull()
      .default(false),
    completedAt: utcInstant("completed_at"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("task", table),
    index("task_workspace_status_idx").on(table.workspaceId, table.status),
    index("task_workspace_due_idx").on(table.workspaceId, table.dueOn),
    index("task_workspace_derived_from_key_idx").on(
      table.workspaceId,
      table.derivedFromKey,
    ),
    index("task_workspace_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
    check("task_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check(
      "task_priority_valid",
      sql`${table.priority} in ('low', 'medium', 'high')`,
    ),
    check("task_status_valid", sql`${table.status} in ('open', 'completed')`),
    check("task_source_valid", sql`${table.source} in ('manual', 'rule')`),
    check(
      "task_link_pair",
      sql`(${table.entityType} is null and ${table.entityId} is null) or (${table.entityType} is not null and ${table.entityId} is not null)`,
    ),
    check(
      "task_entity_type_valid",
      sql`${table.entityType} is null or ${table.entityType} in ('company', 'contact', 'opportunity', 'application', 'referral')`,
    ),
    check(
      "task_completed_at_matches_status",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
  ],
);

export const tag = sqliteTable(
  "tag",
  {
    ...workspaceOwnedEntityColumns(),
    label: text("label").notNull(),
    labelNormalized: text("label_normalized").notNull(),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("tag", table),
    uniqueIndex("tag_workspace_label_unique").on(
      table.workspaceId,
      table.labelNormalized,
    ),
    index("tag_workspace_label_idx").on(
      table.workspaceId,
      table.labelNormalized,
    ),
    check("tag_label_not_blank", sql`length(trim(${table.label})) > 0`),
    check(
      "tag_label_normalized_not_blank",
      sql`length(trim(${table.labelNormalized})) > 0`,
    ),
  ],
);

export const entityTag = sqliteTable(
  "entity_tag",
  {
    ...workspaceOwnedEntityColumns(),
    tagId: text("tag_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("entity_tag", table),
    uniqueIndex("entity_tag_workspace_link_unique").on(
      table.workspaceId,
      table.tagId,
      table.entityType,
      table.entityId,
    ),
    index("entity_tag_workspace_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
    index("entity_tag_workspace_tag_idx").on(table.workspaceId, table.tagId),
    sameWorkspaceForeignKey(
      "entity_tag_tag_fk",
      { workspaceId: table.workspaceId, parentId: table.tagId },
      tag,
    ).onDelete("cascade"),
    check(
      "entity_tag_entity_type_valid",
      sql`${table.entityType} in ('company', 'contact', 'opportunity')`,
    ),
    check(
      "entity_tag_entity_id_not_blank",
      sql`length(trim(${table.entityId})) > 0`,
    ),
  ],
);

export const notification = sqliteTable(
  "notification",
  {
    ...workspaceOwnedEntityColumns(),
    kind: text("kind").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    title: text("title").notNull(),
    body: text("body"),
    dueOn: text("due_on").notNull(),
    dueAt: utcInstant("due_at").notNull(),
    dueKey: text("due_key").notNull(),
    groupKey: text("group_key"),
    readAt: utcInstant("read_at"),
    snoozedUntil: utcInstant("snoozed_until"),
    dismissedAt: utcInstant("dismissed_at"),
    completedAt: utcInstant("completed_at"),
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("notification", table),
    uniqueIndex("notification_workspace_due_key_unique").on(
      table.workspaceId,
      table.dueKey,
    ),
    index("notification_workspace_due_on_idx").on(
      table.workspaceId,
      table.dueOn,
    ),
    index("notification_workspace_group_key_idx").on(
      table.workspaceId,
      table.groupKey,
    ),
    index("notification_workspace_kind_idx").on(table.workspaceId, table.kind),
    index("notification_workspace_snoozed_idx").on(
      table.workspaceId,
      table.snoozedUntil,
    ),
    check("notification_title_not_blank", sql`length(trim(${table.title})) > 0`),
    check(
      "notification_due_key_not_blank",
      sql`length(trim(${table.dueKey})) > 0`,
    ),
    check(
      "notification_due_on_format",
      sql`${table.dueOn} glob '????-??-??'`,
    ),
    check(
      "notification_link_pair",
      sql`(${table.entityType} is null and ${table.entityId} is null) or (${table.entityType} is not null and ${table.entityId} is not null)`,
    ),
    check(
      "notification_entity_type_valid",
      sql`${table.entityType} is null or ${table.entityType} in ('company', 'contact', 'opportunity', 'application', 'referral', 'task')`,
    ),
  ],
);


