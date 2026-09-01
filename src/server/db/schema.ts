import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
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
    createdAt: utcInstant("created_at").notNull(),
  },
  (table) => [
    workspaceEntityKey("company", table),
    index("company_workspace_name_idx").on(table.workspaceId, table.name),
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
