CREATE TABLE `send_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text,
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
	CONSTRAINT "send_queue_origin_valid" CHECK("send_queue"."origin" in ('one_off', 'sequence', 'self_digest')),
	CONSTRAINT "send_queue_status_valid" CHECK("send_queue"."status" in ('awaiting_approval', 'approved', 'claimed', 'sent', 'failed', 'held', 'cancelled')),
	CONSTRAINT "send_queue_recipient_not_blank" CHECK(length(trim("send_queue"."recipient")) > 0),
	CONSTRAINT "send_queue_payload_hash_not_blank" CHECK(length(trim("send_queue"."payload_hash")) > 0),
	CONSTRAINT "send_queue_message_id_not_blank" CHECK(length(trim("send_queue"."message_id")) > 0),
	CONSTRAINT "send_queue_approval_kind_valid" CHECK("send_queue"."approval_kind" is null or "send_queue"."approval_kind" in ('owner_click', 'self_digest_policy')),
	CONSTRAINT "send_queue_attempts_nonnegative" CHECK("send_queue"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_workspace_id_id_unique` ON `send_queue` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_queue_message_id_unique` ON `send_queue` (`message_id`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_status_send_idx` ON `send_queue` (`workspace_id`,`status`,`send_at`);--> statement-breakpoint
CREATE INDEX `send_queue_workspace_account_sent_idx` ON `send_queue` (`workspace_id`,`account_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `suppression_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`source_key` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "suppression_entry_email_not_blank" CHECK(length(trim("suppression_entry"."email")) > 0),
	CONSTRAINT "suppression_entry_source_not_blank" CHECK(length(trim("suppression_entry"."source_key")) > 0),
	CONSTRAINT "suppression_entry_reason_valid" CHECK("suppression_entry"."reason" in ('do_not_contact', 'invalid_email', 'unsubscribed', 'bounced', 'asked_not_to_follow_up', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_entry_workspace_id_id_unique` ON `suppression_entry` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `suppression_entry_workspace_email_idx` ON `suppression_entry` (`workspace_id`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_entry_workspace_source_unique` ON `suppression_entry` (`workspace_id`,`email`,`source_key`);--> statement-breakpoint
INSERT OR IGNORE INTO `suppression_entry` (`id`, `workspace_id`, `email`, `reason`, `source_key`, `at`)
SELECT
	'suppression-contact-' || `contact_method`.`id`,
	`contact_method`.`workspace_id`,
	`contact_method`.`value_normalized`,
	'do_not_contact',
	'contact:' || `contact`.`id`,
	`contact_method`.`created_at`
FROM `contact_method`
INNER JOIN `contact`
	ON `contact`.`workspace_id` = `contact_method`.`workspace_id`
	AND `contact`.`id` = `contact_method`.`contact_id`
WHERE `contact_method`.`kind` = 'email'
	AND `contact`.`networking_status` = 'do_not_contact';
