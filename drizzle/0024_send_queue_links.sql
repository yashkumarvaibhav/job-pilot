PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_send_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text,
	`opportunity_id` text,
	`referral_id` text,
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
	CONSTRAINT "send_queue_origin_valid" CHECK("__new_send_queue"."origin" in ('one_off', 'sequence', 'self_digest')),
	CONSTRAINT "send_queue_status_valid" CHECK("__new_send_queue"."status" in ('awaiting_approval', 'approved', 'claimed', 'sent', 'failed', 'held', 'cancelled')),
	CONSTRAINT "send_queue_recipient_not_blank" CHECK(length(trim("__new_send_queue"."recipient")) > 0),
	CONSTRAINT "send_queue_payload_hash_not_blank" CHECK(length(trim("__new_send_queue"."payload_hash")) > 0),
	CONSTRAINT "send_queue_message_id_not_blank" CHECK(length(trim("__new_send_queue"."message_id")) > 0),
	CONSTRAINT "send_queue_approval_kind_valid" CHECK("__new_send_queue"."approval_kind" is null or "__new_send_queue"."approval_kind" in ('owner_click', 'self_digest_policy')),
	CONSTRAINT "send_queue_attempts_nonnegative" CHECK("__new_send_queue"."attempts" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_send_queue`("id", "workspace_id", "account_id", "contact_id", "opportunity_id", "referral_id", "origin", "status", "recipient", "subject", "body", "attachment_version_ids_json", "send_at", "payload_hash", "approval_hash", "approved_at", "approval_kind", "message_id", "claimed_at", "attempts", "last_error", "gmail_message_id", "gmail_thread_id", "sent_at", "created_at", "updated_at") SELECT "id", "workspace_id", "account_id", "contact_id", NULL, NULL, "origin", "status", "recipient", "subject", "body", "attachment_version_ids_json", "send_at", "payload_hash", "approval_hash", "approved_at", "approval_kind", "message_id", "claimed_at", "attempts", "last_error", "gmail_message_id", "gmail_thread_id", "sent_at", "created_at", "updated_at" FROM `send_queue`;--> statement-breakpoint
DROP TABLE `send_queue`;--> statement-breakpoint
ALTER TABLE `__new_send_queue` RENAME TO `send_queue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_workspace_id_id_unique` ON `send_queue` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_message_id_unique` ON `send_queue` (`message_id`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_status_send_idx` ON `send_queue` (`workspace_id`,`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_account_sent_idx` ON `send_queue` (`workspace_id`,`account_id`,`sent_at`);
