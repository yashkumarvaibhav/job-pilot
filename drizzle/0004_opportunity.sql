CREATE TABLE `opportunity` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text NOT NULL,
	`role` text NOT NULL,
	`job_id` text,
	`url` text,
	`location` text,
	`work_mode` text,
	`employment_type` text,
	`experience_requirement` text,
	`source` text,
	`discovered_on` text,
	`posted_on` text,
	`deadline_on` text,
	`compensation` text,
	`priority` text,
	`interest_score` integer,
	`eligibility` text,
	`referral_preferred` integer DEFAULT false NOT NULL,
	`resume_version_id` text,
	`jd_snapshot` text,
	`notes` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`bucket` text DEFAULT 'saved' NOT NULL,
	`stage` text DEFAULT 'discovered' NOT NULL,
	`next_action` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`company_id`) REFERENCES `company`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "opportunity_role_not_blank" CHECK(length(trim("opportunity"."role")) > 0),
	CONSTRAINT "opportunity_bucket_valid" CHECK("opportunity"."bucket" in ('saved', 'active')),
	CONSTRAINT "opportunity_stage_valid" CHECK("opportunity"."stage" in ('discovered', 'saved', 'interested', 'pursuing', 'finding_contacts', 'finding_referral', 'referral_requested', 'referral_promised', 'referral_received', 'ready_to_apply', 'applied', 'ghosted', 'position_closed', 'withdrawn', 'not_eligible', 'duplicate', 'no_longer_interested', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_workspace_id_id_unique` ON `opportunity` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `opportunity_workspace_company_idx` ON `opportunity` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `opportunity_workspace_bucket_idx` ON `opportunity` (`workspace_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `opportunity_workspace_stage_idx` ON `opportunity` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `opportunity_workspace_deadline_idx` ON `opportunity` (`workspace_id`,`deadline_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_workspace_company_job_id_unique` ON `opportunity` (`workspace_id`,`company_id`,`job_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_interaction` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text,
	`company_id` text,
	`opportunity_id` text,
	`referral_id` text,
	`channel` text NOT NULL,
	`direction` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`email_message_id` text,
	`requires_reply` integer DEFAULT false NOT NULL,
	`reply_resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`company_id`) REFERENCES `company`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "interaction_context_present" CHECK("__new_interaction"."contact_id" is not null or "__new_interaction"."company_id" is not null or "__new_interaction"."opportunity_id" is not null or "__new_interaction"."referral_id" is not null),
	CONSTRAINT "interaction_channel_valid" CHECK("__new_interaction"."channel" in ('email', 'linkedin_dm', 'linkedin_connection_note', 'whatsapp', 'phone', 'telegram', 'slack_discord', 'company_referral_portal', 'alumni_network', 'college_network', 'in_person', 'other')),
	CONSTRAINT "interaction_direction_valid" CHECK("__new_interaction"."direction" in ('outbound', 'inbound')),
	CONSTRAINT "interaction_requires_reply_inbound" CHECK("__new_interaction"."requires_reply" = false or "__new_interaction"."direction" = 'inbound')
);
--> statement-breakpoint
INSERT INTO `__new_interaction`("id", "workspace_id", "contact_id", "company_id", "opportunity_id", "referral_id", "channel", "direction", "occurred_at", "body", "email_message_id", "requires_reply", "reply_resolved_at", "created_at") SELECT "id", "workspace_id", "contact_id", "company_id", "opportunity_id", "referral_id", "channel", "direction", "occurred_at", "body", "email_message_id", "requires_reply", "reply_resolved_at", "created_at" FROM `interaction`;--> statement-breakpoint
DROP TABLE `interaction`;--> statement-breakpoint
ALTER TABLE `__new_interaction` RENAME TO `interaction`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_workspace_id_id_unique` ON `interaction` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_contact_idx` ON `interaction` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_company_idx` ON `interaction` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_opportunity_idx` ON `interaction` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_referral_idx` ON `interaction` (`workspace_id`,`referral_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_occurred_idx` ON `interaction` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_need_reply_idx` ON `interaction` (`workspace_id`,`requires_reply`,`reply_resolved_at`);