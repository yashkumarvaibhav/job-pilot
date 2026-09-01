CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_on` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`derived_from_key` text,
	`created_by_rule` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_title_not_blank" CHECK(length(trim("task"."title")) > 0),
	CONSTRAINT "task_priority_valid" CHECK("task"."priority" in ('low', 'medium', 'high')),
	CONSTRAINT "task_status_valid" CHECK("task"."status" in ('open', 'completed')),
	CONSTRAINT "task_source_valid" CHECK("task"."source" in ('manual', 'rule')),
	CONSTRAINT "task_link_pair" CHECK(("task"."entity_type" is null and "task"."entity_id" is null) or ("task"."entity_type" is not null and "task"."entity_id" is not null)),
	CONSTRAINT "task_entity_type_valid" CHECK("task"."entity_type" is null or "task"."entity_type" in ('company', 'contact', 'opportunity', 'application', 'referral')),
	CONSTRAINT "task_completed_at_matches_status" CHECK(("task"."status" = 'completed' and "task"."completed_at" is not null) or ("task"."status" <> 'completed' and "task"."completed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_workspace_id_id_unique` ON `task` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `task_workspace_status_idx` ON `task` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `task_workspace_due_idx` ON `task` (`workspace_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `task_workspace_derived_from_key_idx` ON `task` (`workspace_id`,`derived_from_key`);--> statement-breakpoint
CREATE INDEX `task_workspace_entity_idx` ON `task` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
ALTER TABLE `company` ADD `next_action` text;--> statement-breakpoint
ALTER TABLE `company` ADD `next_action_due` text;--> statement-breakpoint
CREATE INDEX `company_workspace_next_action_due_idx` ON `company` (`workspace_id`,`next_action_due`);--> statement-breakpoint
ALTER TABLE `opportunity` ADD `next_action_due` text;--> statement-breakpoint
CREATE INDEX `opportunity_workspace_next_action_due_idx` ON `opportunity` (`workspace_id`,`next_action_due`);