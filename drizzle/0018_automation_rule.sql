CREATE TABLE `automation_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`spec_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "automation_rule_slug_not_blank" CHECK(length(trim("automation_rule"."slug")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_rule_workspace_id_id_unique` ON `automation_rule` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `automation_rule_workspace_slug_unique` ON `automation_rule` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE TABLE `automation_execution` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`at` integer NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`rule_id`) REFERENCES `automation_rule`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_execution_workspace_id_id_unique` ON `automation_execution` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `automation_execution_workspace_rule_idx` ON `automation_execution` (`workspace_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `automation_execution_workspace_at_idx` ON `automation_execution` (`workspace_id`,`at`);--> statement-breakpoint
INSERT INTO `automation_rule` (`id`, `workspace_id`, `slug`, `enabled`, `spec_json`, `created_at`)
SELECT
	`workspace`.`id` || ':' || `slug`.`slug`,
	`workspace`.`id`,
	`slug`.`slug`,
	1,
	'{}',
	CAST(unixepoch('now') * 1000 AS INTEGER)
FROM `workspace`
CROSS JOIN (
	SELECT 'referral_no_response_follow_up' AS `slug`
	UNION ALL SELECT 'referral_received_ready_to_apply'
	UNION ALL SELECT 'applied_cancel_referral_outreach'
	UNION ALL SELECT 'stale_opportunity_no_activity'
	UNION ALL SELECT 'stale_no_recruiter_response'
	UNION ALL SELECT 'stale_referral_promised_not_received'
	UNION ALL SELECT 'stale_referral_received_not_applied'
	UNION ALL SELECT 'stale_job_deadline'
	UNION ALL SELECT 'stale_assessment_deadline'
	UNION ALL SELECT 'stale_interview_past_no_result'
	UNION ALL SELECT 'stale_networking_check_later'
) AS `slug`;
