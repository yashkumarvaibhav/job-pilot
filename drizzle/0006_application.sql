CREATE TABLE `application` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`portal` text NOT NULL,
	`applied_on` text NOT NULL,
	`application_external_id` text,
	`referrer` text,
	`resume_version_id` text,
	`stage` text DEFAULT 'applied' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_portal_not_blank" CHECK(length(trim("application"."portal")) > 0),
	CONSTRAINT "application_stage_valid" CHECK("application"."stage" in ('applied', 'application_confirmed', 'under_review', 'oa_received', 'oa_completed', 'interview_scheduled', 'interview_round_1', 'interview_round_2', 'hiring_manager', 'hr', 'offer', 'rejected', 'withdrawn', 'ghosted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_workspace_id_id_unique` ON `application` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_workspace_opportunity_unique` ON `application` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `application_workspace_stage_idx` ON `application` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `application_workspace_applied_on_idx` ON `application` (`workspace_id`,`applied_on`);