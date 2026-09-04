ALTER TABLE `settings` ADD `contact_cooldown_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `max_outreach_per_opportunity` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `contact_method` ADD `invalid_at` integer;--> statement-breakpoint
CREATE TABLE `bounce_event` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`email` text NOT NULL,
	`gmail_message_id` text NOT NULL,
	`kind` text NOT NULL,
	`smtp_status` text,
	`diagnostic` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bounce_event_email_not_blank" CHECK(length(trim("bounce_event"."email")) > 0),
	CONSTRAINT "bounce_event_gmail_message_id_not_blank" CHECK(length(trim("bounce_event"."gmail_message_id")) > 0),
	CONSTRAINT "bounce_event_kind_valid" CHECK("bounce_event"."kind" in ('hard', 'soft'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bounce_event_workspace_id_id_unique` ON `bounce_event` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bounce_event_workspace_account_gmail_unique` ON `bounce_event` (`workspace_id`,`account_id`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `bounce_event_workspace_email_idx` ON `bounce_event` (`workspace_id`,`email`);--> statement-breakpoint
CREATE INDEX `bounce_event_workspace_account_idx` ON `bounce_event` (`workspace_id`,`account_id`);
