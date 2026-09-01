CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`company_id` text,
	`name` text NOT NULL,
	`designation` text,
	`relationship` text DEFAULT 'unknown_cold_contact' NOT NULL,
	`source` text,
	`location` text,
	`notes` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`preferred_contact_channel` text,
	`networking_status` text DEFAULT 'not_contacted' NOT NULL,
	`last_interaction_at` integer,
	`next_action` text,
	`follow_up_on` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`company_id`) REFERENCES `company`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_name_not_blank" CHECK(length(trim("contact"."name")) > 0),
	CONSTRAINT "contact_relationship_valid" CHECK("contact"."relationship" in ('friend', 'college_friend', 'alumni', 'employee', 'recruiter', 'hiring_manager', 'former_employee', 'mutual_connection', 'community_contact', 'unknown_cold_contact', 'other')),
	CONSTRAINT "contact_networking_status_valid" CHECK("contact"."networking_status" in ('not_contacted', 'ready_to_contact', 'contacted', 'waiting_for_reply', 'checking_for_openings', 'follow_up_later', 'opening_found', 'referral_discussion', 'referral_promised', 'no_openings_currently', 'keep_in_touch', 'do_not_contact', 'inactive')),
	CONSTRAINT "contact_preferred_channel_valid" CHECK("contact"."preferred_contact_channel" is null or "contact"."preferred_contact_channel" in ('email', 'linkedin', 'phone', 'whatsapp', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_workspace_id_id_unique` ON `contact` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `contact_workspace_name_idx` ON `contact` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `contact_workspace_company_idx` ON `contact` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `contact_workspace_status_idx` ON `contact` (`workspace_id`,`networking_status`);--> statement-breakpoint
CREATE INDEX `contact_workspace_follow_up_idx` ON `contact` (`workspace_id`,`follow_up_on`);--> statement-breakpoint
CREATE TABLE `contact_method` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`value_normalized` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "contact_method_kind_valid" CHECK("contact_method"."kind" in ('email', 'linkedin', 'phone', 'whatsapp', 'other')),
	CONSTRAINT "contact_method_value_not_blank" CHECK(length(trim("contact_method"."value")) > 0 and length(trim("contact_method"."value_normalized")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_method_workspace_id_id_unique` ON `contact_method` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `contact_method_workspace_contact_idx` ON `contact_method` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_method_workspace_kind_value_unique` ON `contact_method` (`workspace_id`,`kind`,`value_normalized`);