CREATE TABLE `interaction` (
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
	CONSTRAINT "interaction_context_present" CHECK("interaction"."contact_id" is not null or "interaction"."company_id" is not null or "interaction"."opportunity_id" is not null or "interaction"."referral_id" is not null),
	CONSTRAINT "interaction_channel_valid" CHECK("interaction"."channel" in ('email', 'linkedin_dm', 'linkedin_connection_note', 'whatsapp', 'phone', 'telegram', 'slack_discord', 'company_referral_portal', 'alumni_network', 'college_network', 'in_person', 'other')),
	CONSTRAINT "interaction_direction_valid" CHECK("interaction"."direction" in ('outbound', 'inbound')),
	CONSTRAINT "interaction_requires_reply_inbound" CHECK("interaction"."requires_reply" = false or "interaction"."direction" = 'inbound')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interaction_workspace_id_id_unique` ON `interaction` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_contact_idx` ON `interaction` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_company_idx` ON `interaction` (`workspace_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_opportunity_idx` ON `interaction` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_referral_idx` ON `interaction` (`workspace_id`,`referral_id`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_occurred_idx` ON `interaction` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `interaction_workspace_need_reply_idx` ON `interaction` (`workspace_id`,`requires_reply`,`reply_resolved_at`);