ALTER TABLE `email_account` ADD `last_sync_error` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`account_id` text NOT NULL,
	`gmail_id` text NOT NULL,
	`rfc_message_id` text,
	`direction` text NOT NULL,
	`from_email` text NOT NULL,
	`to_json` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`attachment_version_ids_json` text DEFAULT '[]' NOT NULL,
	`classification` text,
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`thread_id`,`account_id`) REFERENCES `email_thread`(`workspace_id`,`id`,`account_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_message_gmail_id_not_blank" CHECK(length(trim("__new_email_message"."gmail_id")) > 0),
	CONSTRAINT "email_message_from_email_not_blank" CHECK(length(trim("__new_email_message"."from_email")) > 0),
	CONSTRAINT "email_message_direction_valid" CHECK("__new_email_message"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "email_message_classification_valid" CHECK("__new_email_message"."classification" is null or "__new_email_message"."classification" in ('referral_promised', 'referral_submitted', 'declined', 'need_to_respond', 'no_opening', 'follow_up_later', 'not_relevant'))
);
--> statement-breakpoint
INSERT INTO `__new_email_message`("id", "workspace_id", "thread_id", "account_id", "gmail_id", "rfc_message_id", "direction", "from_email", "to_json", "subject", "body", "attachment_version_ids_json", "classification", "sent_at", "created_at") SELECT "id", "workspace_id", "thread_id", "account_id", "gmail_id", "rfc_message_id", "direction", "from_email", "to_json", "subject", "body", "attachment_version_ids_json", NULL, "sent_at", "created_at" FROM `email_message`;--> statement-breakpoint
DROP TABLE `email_message`;--> statement-breakpoint
ALTER TABLE `__new_email_message` RENAME TO `email_message`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_workspace_id_id_unique` ON `email_message` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_account_gmail_unique` ON `email_message` (`account_id`,`gmail_id`);--> statement-breakpoint
CREATE INDEX `email_message_workspace_thread_idx` ON `email_message` (`workspace_id`,`thread_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `email_message_workspace_account_sent_idx` ON `email_message` (`workspace_id`,`account_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `__new_email_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`contact_id` text,
	`company_id` text,
	`opportunity_id` text,
	`referral_id` text,
	`source` text DEFAULT 'sync' NOT NULL,
	`match_status` text DEFAULT 'unmatched' NOT NULL,
	`match_reason` text,
	`suggested_contact_ids_json` text DEFAULT '[]' NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`company_id`) REFERENCES `company`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`referral_id`) REFERENCES `referral_request`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_thread_source_valid" CHECK("__new_email_thread"."source" in ('sent', 'sync', 'manual_import')),
	CONSTRAINT "email_thread_match_status_valid" CHECK("__new_email_thread"."match_status" in ('unmatched', 'automatic', 'suggested', 'manual')),
	CONSTRAINT "email_thread_gmail_id_not_blank" CHECK(length(trim("__new_email_thread"."gmail_thread_id")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_email_thread`("id", "workspace_id", "account_id", "gmail_thread_id", "subject", "contact_id", "company_id", "opportunity_id", "referral_id", "source", "match_status", "match_reason", "suggested_contact_ids_json", "last_message_at", "created_at", "updated_at") SELECT "id", "workspace_id", "account_id", "gmail_thread_id", "subject", "contact_id", "company_id", "opportunity_id", "referral_id", "source", CASE WHEN "contact_id" IS NOT NULL OR "company_id" IS NOT NULL OR "opportunity_id" IS NOT NULL OR "referral_id" IS NOT NULL THEN 'automatic' ELSE 'unmatched' END, CASE WHEN "source" = 'sent' THEN 'Existing outbound thread' ELSE NULL END, '[]', "last_message_at", "created_at", "updated_at" FROM `email_thread`;--> statement-breakpoint
DROP TABLE `email_thread`;--> statement-breakpoint
ALTER TABLE `__new_email_thread` RENAME TO `email_thread`;--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_workspace_id_id_unique` ON `email_thread` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `email_thread_workspace_account_idx` ON `email_thread` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_account_gmail_unique` ON `email_thread` (`account_id`,`gmail_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_workspace_id_account_unique` ON `email_thread` (`workspace_id`,`id`,`account_id`);--> statement-breakpoint
CREATE INDEX `email_thread_workspace_last_message_idx` ON `email_thread` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_workspace_email_message_unique` ON `interaction` (`workspace_id`,`email_message_id`);
