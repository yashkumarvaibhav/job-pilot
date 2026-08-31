import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
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
    uniqueIndex("activity_event_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    index("activity_event_workspace_at_idx").on(table.workspaceId, table.at),
    index("activity_event_workspace_entity_idx").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
  ],
);
