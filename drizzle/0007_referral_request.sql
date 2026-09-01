CREATE TABLE `referral_request` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`opportunity_id` text,
	`requested_on` text,
	`channel` text NOT NULL,
	`resume_shared` integer DEFAULT false NOT NULL,
	`job_id_shared` integer DEFAULT false NOT NULL,
	`job_url_shared` integer DEFAULT false NOT NULL,
	`stage` text DEFAULT 'potential_contact' NOT NULL,
	`follow_up_on` text,
	`received_on` text,
	`confirmation` text,
	`next_action` text,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "referral_request_channel_valid" CHECK("referral_request"."channel" in ('email', 'linkedin_dm', 'linkedin_connection_note', 'whatsapp', 'phone', 'telegram', 'slack_discord', 'company_referral_portal', 'alumni_network', 'college_network', 'in_person', 'other')),
	CONSTRAINT "referral_request_stage_valid" CHECK("referral_request"."stage" in ('potential_contact', 'ready_to_contact', 'requested', 'seen_acknowledged', 'asked_for_resume', 'resume_sent', 'agreed_to_refer', 'referral_promised', 'referral_submitted', 'referral_received', 'declined', 'no_response', 'expired', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_request_workspace_id_id_unique` ON `referral_request` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `referral_request_workspace_contact_idx` ON `referral_request` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `referral_request_workspace_opportunity_idx` ON `referral_request` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `referral_request_workspace_stage_idx` ON `referral_request` (`workspace_id`,`stage`);--> statement-breakpoint
CREATE INDEX `referral_request_workspace_requested_on_idx` ON `referral_request` (`workspace_id`,`requested_on`);--> statement-breakpoint
CREATE INDEX `referral_request_workspace_follow_up_idx` ON `referral_request` (`workspace_id`,`follow_up_on`);--> statement-breakpoint
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
	FOREIGN KEY (`workspace_id`,`referral_id`) REFERENCES `referral_request`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
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