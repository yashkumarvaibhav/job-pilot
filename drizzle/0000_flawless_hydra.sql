CREATE TABLE `account_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_digest` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_token_purpose_valid" CHECK("account_token"."purpose" in ('verify_email', 'reset_password'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_token_token_digest_unique` ON `account_token` (`token_digest`);--> statement-breakpoint
CREATE INDEX `account_token_user_purpose_idx` ON `account_token` (`user_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `activity_event` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_event_workspace_id_id_unique` ON `activity_event` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `activity_event_workspace_at_idx` ON `activity_event` (`workspace_id`,`at`);--> statement-breakpoint
CREATE INDEX `activity_event_workspace_entity_idx` ON `activity_event` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_digest_unique` ON `auth_session` (`token_digest`);--> statement-breakpoint
CREATE INDEX `auth_session_user_id_idx` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_session_user_expiry_idx` ON `auth_session` (`user_id`,`idle_expires_at`,`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`university` text,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`scoring_weights_json` text DEFAULT '{}' NOT NULL,
	`quiet_start` integer,
	`quiet_end` integer,
	`digest_hour` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "settings_timezone_not_blank" CHECK(length(trim("settings"."timezone")) > 0),
	CONSTRAINT "settings_quiet_start_range" CHECK("settings"."quiet_start" is null or "settings"."quiet_start" between 0 and 1439),
	CONSTRAINT "settings_quiet_end_range" CHECK("settings"."quiet_end" is null or "settings"."quiet_end" between 0 and 1439),
	CONSTRAINT "settings_digest_hour_range" CHECK("settings"."digest_hour" is null or "settings"."digest_hour" between 0 and 23)
);
--> statement-breakpoint
CREATE INDEX `settings_workspace_idx` ON `settings` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `user_account` (
	`id` text PRIMARY KEY NOT NULL,
	`email_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`email_verified_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_account_email_normalized_unique` ON `user_account` (`email_normalized`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owner_user_id_unique` ON `workspace` (`owner_user_id`);