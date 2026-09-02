CREATE TABLE `assessment` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`application_id` text,
	`kind` text NOT NULL,
	`platform` text,
	`invited_at` integer,
	`window_opens_at` integer,
	`due_at` integer,
	`duration_minutes` integer,
	`status` text DEFAULT 'invited' NOT NULL,
	`result` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`application_id`) REFERENCES `application`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assessment_kind_not_blank" CHECK(length(trim("assessment"."kind")) > 0),
	CONSTRAINT "assessment_status_valid" CHECK("assessment"."status" in ('invited', 'completed', 'cancelled')),
	CONSTRAINT "assessment_duration_minutes_positive" CHECK("assessment"."duration_minutes" is null or "assessment"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_workspace_id_id_unique` ON `assessment` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `assessment_workspace_opportunity_idx` ON `assessment` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `assessment_workspace_application_idx` ON `assessment` (`workspace_id`,`application_id`);--> statement-breakpoint
CREATE INDEX `assessment_workspace_due_idx` ON `assessment` (`workspace_id`,`due_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_application` (
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
	`offer_deadline_on` text,
	`offer_decision` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "application_portal_not_blank" CHECK(length(trim("__new_application"."portal")) > 0),
	CONSTRAINT "application_stage_valid" CHECK("__new_application"."stage" in ('applied', 'application_confirmed', 'under_review', 'oa_received', 'oa_completed', 'interview_scheduled', 'interview_round_1', 'interview_round_2', 'hiring_manager', 'hr', 'offer', 'rejected', 'withdrawn', 'ghosted')),
	CONSTRAINT "application_offer_decision_valid" CHECK("__new_application"."offer_decision" is null or "__new_application"."offer_decision" in ('accepted', 'declined'))
);
--> statement-breakpoint
INSERT INTO `__new_application`("id", "workspace_id", "opportunity_id", "portal", "applied_on", "application_external_id", "referrer", "resume_version_id", "stage", "notes", "offer_deadline_on", "offer_decision", "created_at") SELECT "id", "workspace_id", "opportunity_id", "portal", "applied_on", "application_external_id", "referrer", "resume_version_id", "stage", "notes", NULL, NULL, "created_at" FROM `application`;--> statement-breakpoint
DROP TABLE `application`;--> statement-breakpoint
ALTER TABLE `__new_application` RENAME TO `application`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `application_workspace_id_id_unique` ON `application` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `application_workspace_opportunity_unique` ON `application` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `application_workspace_stage_idx` ON `application` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `application_workspace_applied_on_idx` ON `application` (`workspace_id`,`applied_on`);--> statement-breakpoint
CREATE INDEX `application_workspace_offer_deadline_idx` ON `application` (`workspace_id`,`offer_deadline_on`);