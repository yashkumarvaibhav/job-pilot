PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`digest_email_enabled` integer DEFAULT false NOT NULL,
	`digest_account_id` text,
	`digest_account_email` text,
	`contact_cooldown_days` integer DEFAULT 30 NOT NULL,
	`max_outreach_per_opportunity` integer DEFAULT 10 NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`default_email_account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`digest_account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_timezone_not_blank" CHECK(length(trim(`timezone`)) > 0),
	CONSTRAINT "settings_quiet_start_range" CHECK(`quiet_start` is null or `quiet_start` between 0 and 1439),
	CONSTRAINT "settings_quiet_end_range" CHECK(`quiet_end` is null or `quiet_end` between 0 and 1439),
	CONSTRAINT "settings_digest_hour_range" CHECK(`digest_hour` is null or `digest_hour` between 0 and 23),
	CONSTRAINT "settings_contact_cooldown_days_range" CHECK(`contact_cooldown_days` between 1 and 365),
	CONSTRAINT "settings_max_outreach_per_opportunity_range" CHECK(`max_outreach_per_opportunity` between 1 and 100),
	CONSTRAINT "settings_digest_email_enabled_valid" CHECK(`digest_email_enabled` in (0, 1)),
	CONSTRAINT "settings_digest_enabled_needs_account" CHECK(`digest_email_enabled` = 0 or `digest_account_id` is not null)
);
--> statement-breakpoint
INSERT INTO `__new_settings` (
	`workspace_id`,
	`display_name`,
	`university`,
	`timezone`,
	`scoring_weights_json`,
	`muted_notification_kinds_json`,
	`quiet_start`,
	`quiet_end`,
	`digest_hour`,
	`default_email_account_id`,
	`digest_email_enabled`,
	`digest_account_id`,
	`digest_account_email`,
	`contact_cooldown_days`,
	`max_outreach_per_opportunity`
)
SELECT
	`workspace_id`,
	`display_name`,
	`university`,
	`timezone`,
	`scoring_weights_json`,
	`muted_notification_kinds_json`,
	`quiet_start`,
	`quiet_end`,
	`digest_hour`,
	`default_email_account_id`,
	0,
	NULL,
	NULL,
	`contact_cooldown_days`,
	`max_outreach_per_opportunity`
FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
CREATE INDEX `settings_workspace_idx` ON `settings` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `digest_run` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`local_date` text NOT NULL,
	`at` integer NOT NULL,
	`outcome` text NOT NULL,
	`account_id` text,
	`recipient` text,
	`queue_id` text,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`queue_id`) REFERENCES `send_queue`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "digest_run_local_date_iso" CHECK(`local_date` glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "digest_run_outcome_valid" CHECK(`outcome` in ('previewed', 'queued', 'skipped_disconnected', 'skipped_quiet'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digest_run_workspace_id_id_unique` ON `digest_run` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `digest_run_workspace_local_date_unique` ON `digest_run` (`workspace_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `digest_run_workspace_at_idx` ON `digest_run` (`workspace_id`,`at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
