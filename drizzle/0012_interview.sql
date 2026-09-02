CREATE TABLE `interview` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`round_index` integer NOT NULL,
	`kind` text NOT NULL,
	`at` integer,
	`meeting_url` text,
	`interviewer` text,
	`questions` text,
	`prep_notes` text,
	`performance` text,
	`result` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "interview_kind_not_blank" CHECK(length(trim("interview"."kind")) > 0),
	CONSTRAINT "interview_round_index_positive" CHECK("interview"."round_index" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_workspace_id_id_unique` ON `interview` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `interview_workspace_opportunity_round_unique` ON `interview` (`workspace_id`,`opportunity_id`,`round_index`);--> statement-breakpoint
CREATE INDEX `interview_workspace_opportunity_idx` ON `interview` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `interview_workspace_at_idx` ON `interview` (`workspace_id`,`at`);