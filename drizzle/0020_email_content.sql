CREATE TABLE `email_template` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`variables_json` text DEFAULT '[]' NOT NULL,
	`default_email_account_id` text,
	`default_document_version_id` text,
	`default_follow_up_days` integer,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`default_email_account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`,`default_document_version_id`) REFERENCES `document_version`(`workspace_id`,`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_template_title_not_blank" CHECK(length(trim("email_template"."title")) > 0),
	CONSTRAINT "email_template_follow_up_days_range" CHECK("email_template"."default_follow_up_days" is null or "email_template"."default_follow_up_days" between 0 and 365)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_template_workspace_id_id_unique` ON `email_template` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_template_workspace_title_unique` ON `email_template` (`workspace_id`,`title`);--> statement-breakpoint
CREATE INDEX `email_template_workspace_account_idx` ON `email_template` (`workspace_id`,`default_email_account_id`);--> statement-breakpoint
CREATE TABLE `email_thread` (
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
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`company_id`) REFERENCES `company`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`referral_id`) REFERENCES `referral_request`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_thread_source_valid" CHECK("email_thread"."source" in ('sent', 'sync', 'manual_import')),
	CONSTRAINT "email_thread_gmail_id_not_blank" CHECK(length(trim("email_thread"."gmail_thread_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_workspace_id_id_unique` ON `email_thread` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `email_thread_workspace_account_idx` ON `email_thread` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_account_gmail_unique` ON `email_thread` (`account_id`,`gmail_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_workspace_id_account_unique` ON `email_thread` (`workspace_id`,`id`,`account_id`);--> statement-breakpoint
CREATE INDEX `email_thread_workspace_last_message_idx` ON `email_thread` (`workspace_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `email_message` (
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
	`sent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`thread_id`,`account_id`) REFERENCES `email_thread`(`workspace_id`,`id`,`account_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_message_gmail_id_not_blank" CHECK(length(trim("email_message"."gmail_id")) > 0),
	CONSTRAINT "email_message_from_email_not_blank" CHECK(length(trim("email_message"."from_email")) > 0),
	CONSTRAINT "email_message_direction_valid" CHECK("email_message"."direction" in ('inbound', 'outbound'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_workspace_id_id_unique` ON `email_message` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_account_gmail_unique` ON `email_message` (`account_id`,`gmail_id`);--> statement-breakpoint
CREATE INDEX `email_message_workspace_thread_idx` ON `email_message` (`workspace_id`,`thread_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `email_message_workspace_account_sent_idx` ON `email_message` (`workspace_id`,`account_id`,`sent_at`);
