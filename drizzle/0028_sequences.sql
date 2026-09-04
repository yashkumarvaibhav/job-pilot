CREATE TABLE `email_sequence` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "email_sequence_name_not_blank" CHECK(length(trim("email_sequence"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_sequence_workspace_id_id_unique` ON `email_sequence` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_sequence_workspace_name_unique` ON `email_sequence` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `sequence_step` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`offset_days` integer NOT NULL,
	`template_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`sequence_id`) REFERENCES `email_sequence`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`template_id`) REFERENCES `email_template`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sequence_step_offset_nonnegative" CHECK("sequence_step"."offset_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_step_workspace_id_id_unique` ON `sequence_step` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_step_workspace_sequence_offset_unique` ON `sequence_step` (`workspace_id`,`sequence_id`,`offset_days`);--> statement-breakpoint
CREATE INDEX `sequence_step_workspace_sequence_idx` ON `sequence_step` (`workspace_id`,`sequence_id`);--> statement-breakpoint
CREATE TABLE `sequence_enrollment` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`sequence_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`opportunity_id` text,
	`account_id` text NOT NULL,
	`current_step_id` text NOT NULL,
	`thread_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`cancel_reason` text,
	`next_at` integer NOT NULL,
	`thread_proven_at` integer,
	`enrolled_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`sequence_id`) REFERENCES `email_sequence`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`current_step_id`) REFERENCES `sequence_step`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`thread_id`) REFERENCES `email_thread`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sequence_enrollment_status_valid" CHECK("sequence_enrollment"."status" in ('active', 'cancelled', 'completed')),
	CONSTRAINT "sequence_enrollment_cancel_reason_valid" CHECK("sequence_enrollment"."cancel_reason" is null or "sequence_enrollment"."cancel_reason" in ('reply', 'bounce', 'dnc', 'opportunity_closed', 'application_rejected', 'referral_received', 'manual_stop'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sequence_enrollment_workspace_id_id_unique` ON `sequence_enrollment` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `sequence_enrollment_workspace_status_next_idx` ON `sequence_enrollment` (`workspace_id`,`status`,`next_at`);--> statement-breakpoint
CREATE INDEX `sequence_enrollment_workspace_contact_idx` ON `sequence_enrollment` (`workspace_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `sequence_enrollment_workspace_account_idx` ON `sequence_enrollment` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `sequence_enrollment_workspace_sequence_contact_idx` ON `sequence_enrollment` (`workspace_id`,`sequence_id`,`contact_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_send_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text,
	`opportunity_id` text,
	`referral_id` text,
	`enrollment_id` text,
	`step_id` text,
	`origin` text NOT NULL,
	`status` text DEFAULT 'awaiting_approval' NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`attachment_version_ids_json` text DEFAULT '[]' NOT NULL,
	`send_at` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`approval_hash` text,
	`approved_at` integer,
	`approval_kind` text,
	`message_id` text NOT NULL,
	`claimed_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`gmail_message_id` text,
	`gmail_thread_id` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`referral_id`) REFERENCES `referral_request`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`enrollment_id`) REFERENCES `sequence_enrollment`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`,`step_id`) REFERENCES `sequence_step`(`workspace_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "send_queue_origin_valid" CHECK("__new_send_queue"."origin" in ('one_off', 'sequence', 'self_digest')),
	CONSTRAINT "send_queue_status_valid" CHECK("__new_send_queue"."status" in ('awaiting_approval', 'approved', 'claimed', 'sent', 'failed', 'held', 'cancelled')),
	CONSTRAINT "send_queue_recipient_not_blank" CHECK(length(trim("__new_send_queue"."recipient")) > 0),
	CONSTRAINT "send_queue_payload_hash_not_blank" CHECK(length(trim("__new_send_queue"."payload_hash")) > 0),
	CONSTRAINT "send_queue_message_id_not_blank" CHECK(length(trim("__new_send_queue"."message_id")) > 0),
	CONSTRAINT "send_queue_approval_kind_valid" CHECK("__new_send_queue"."approval_kind" is null or "__new_send_queue"."approval_kind" in ('owner_click', 'self_digest_policy')),
	CONSTRAINT "send_queue_attempts_nonnegative" CHECK("__new_send_queue"."attempts" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_send_queue`("id", "workspace_id", "account_id", "contact_id", "opportunity_id", "referral_id", "enrollment_id", "step_id", "origin", "status", "recipient", "subject", "body", "attachment_version_ids_json", "send_at", "payload_hash", "approval_hash", "approved_at", "approval_kind", "message_id", "claimed_at", "attempts", "last_error", "gmail_message_id", "gmail_thread_id", "sent_at", "created_at", "updated_at") SELECT "id", "workspace_id", "account_id", "contact_id", "opportunity_id", "referral_id", NULL, NULL, "origin", "status", "recipient", "subject", "body", "attachment_version_ids_json", "send_at", "payload_hash", "approval_hash", "approved_at", "approval_kind", "message_id", "claimed_at", "attempts", "last_error", "gmail_message_id", "gmail_thread_id", "sent_at", "created_at", "updated_at" FROM `send_queue`;--> statement-breakpoint
DROP TABLE `send_queue`;--> statement-breakpoint
ALTER TABLE `__new_send_queue` RENAME TO `send_queue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_workspace_id_id_unique` ON `send_queue` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_message_id_unique` ON `send_queue` (`message_id`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_status_send_idx` ON `send_queue` (`workspace_id`,`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_account_sent_idx` ON `send_queue` (`workspace_id`,`account_id`,`sent_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_workspace_enrollment_step_unique` ON `send_queue` (`workspace_id`,`enrollment_id`,`step_id`);
