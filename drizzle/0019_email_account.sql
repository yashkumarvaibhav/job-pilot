CREATE TABLE `email_account` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`google_sub` text NOT NULL,
	`email_normalized` text NOT NULL,
	`token_blob` text NOT NULL,
	`sender_name` text DEFAULT '' NOT NULL,
	`signature` text,
	`reply_to` text,
	`daily_limit` integer DEFAULT 40 NOT NULL,
	`sending_window_start` integer DEFAULT 540 NOT NULL,
	`sending_window_end` integer DEFAULT 1020 NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_history_id` text,
	`last_sync_at` integer,
	`sequence_safe_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_account_google_sub_not_blank" CHECK(length(trim(`google_sub`)) > 0),
	CONSTRAINT "email_account_email_not_blank" CHECK(length(trim(`email_normalized`)) > 0),
	CONSTRAINT "email_account_token_blob_not_blank" CHECK(length(trim(`token_blob`)) > 0),
	CONSTRAINT "email_account_daily_limit_range" CHECK(`daily_limit` between 1 and 500),
	CONSTRAINT "email_account_window_start_range" CHECK(`sending_window_start` between 0 and 1439),
	CONSTRAINT "email_account_window_end_range" CHECK(`sending_window_end` between 0 and 1439),
	CONSTRAINT "email_account_status_valid" CHECK(`status` in ('connected', 'disconnected', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_account_workspace_id_id_unique` ON `email_account` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_account_workspace_google_sub_unique` ON `email_account` (`workspace_id`,`google_sub`);--> statement-breakpoint
CREATE INDEX `email_account_workspace_status_idx` ON `email_account` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`university` text,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`scoring_weights_json` text DEFAULT '{}' NOT NULL,
	`muted_notification_kinds_json` text DEFAULT '[]' NOT NULL,
	`quiet_start` integer,
	`quiet_end` integer,
	`digest_hour` integer,
	`default_email_account_id` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`default_email_account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_timezone_not_blank" CHECK(length(trim(`timezone`)) > 0),
	CONSTRAINT "settings_quiet_start_range" CHECK(`quiet_start` is null or `quiet_start` between 0 and 1439),
	CONSTRAINT "settings_quiet_end_range" CHECK(`quiet_end` is null or `quiet_end` between 0 and 1439),
	CONSTRAINT "settings_digest_hour_range" CHECK(`digest_hour` is null or `digest_hour` between 0 and 23)
);
--> statement-breakpoint
INSERT INTO `__new_settings` (`workspace_id`, `display_name`, `university`, `timezone`, `scoring_weights_json`, `muted_notification_kinds_json`, `quiet_start`, `quiet_end`, `digest_hour`)
SELECT `workspace_id`, `display_name`, `university`, `timezone`, `scoring_weights_json`, `muted_notification_kinds_json`, `quiet_start`, `quiet_end`, `digest_hour` FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
CREATE INDEX `settings_workspace_idx` ON `settings` (`workspace_id`);
