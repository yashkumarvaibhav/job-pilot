CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`title` text NOT NULL,
	`body` text,
	`due_on` text NOT NULL,
	`due_at` integer NOT NULL,
	`due_key` text NOT NULL,
	`group_key` text,
	`read_at` integer,
	`snoozed_until` integer,
	`dismissed_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_title_not_blank" CHECK(length(trim("notification"."title")) > 0),
	CONSTRAINT "notification_due_key_not_blank" CHECK(length(trim("notification"."due_key")) > 0),
	CONSTRAINT "notification_due_on_format" CHECK("notification"."due_on" glob '????-??-??'),
	CONSTRAINT "notification_link_pair" CHECK(("notification"."entity_type" is null and "notification"."entity_id" is null) or ("notification"."entity_type" is not null and "notification"."entity_id" is not null)),
	CONSTRAINT "notification_entity_type_valid" CHECK("notification"."entity_type" is null or "notification"."entity_type" in ('company', 'contact', 'opportunity', 'application', 'referral', 'task'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_workspace_id_id_unique` ON `notification` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_workspace_due_key_unique` ON `notification` (`workspace_id`,`due_key`);--> statement-breakpoint
CREATE INDEX `notification_workspace_due_on_idx` ON `notification` (`workspace_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `notification_workspace_group_key_idx` ON `notification` (`workspace_id`,`group_key`);--> statement-breakpoint
CREATE INDEX `notification_workspace_kind_idx` ON `notification` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE INDEX `notification_workspace_snoozed_idx` ON `notification` (`workspace_id`,`snoozed_until`);--> statement-breakpoint
ALTER TABLE `settings` ADD `muted_notification_kinds_json` text DEFAULT '[]' NOT NULL;