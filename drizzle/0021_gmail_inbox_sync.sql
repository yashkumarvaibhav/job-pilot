CREATE TABLE `gmail_recovery_generation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`baseline_history_id` text NOT NULL,
	`status` text DEFAULT 'sweeping' NOT NULL,
	`catch_up_page_token` text,
	`deferred_thread` integer DEFAULT false NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`next_retry_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`account_id`) REFERENCES `email_account`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "gmail_recovery_generation_baseline_not_blank" CHECK(length(trim("gmail_recovery_generation"."baseline_history_id")) > 0),
	CONSTRAINT "gmail_recovery_generation_status_valid" CHECK("gmail_recovery_generation"."status" in ('sweeping', 'catching_up', 'completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_recovery_generation_workspace_id_id_unique` ON `gmail_recovery_generation` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_recovery_generation_workspace_id_account_unique` ON `gmail_recovery_generation` (`workspace_id`,`id`,`account_id`);--> statement-breakpoint
CREATE INDEX `gmail_recovery_workspace_account_status_idx` ON `gmail_recovery_generation` (`workspace_id`,`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `gmail_recovery_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`account_id` text NOT NULL,
	`gmail_thread_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`reconciled_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`generation_id`,`account_id`) REFERENCES `gmail_recovery_generation`(`workspace_id`,`id`,`account_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "gmail_recovery_thread_id_not_blank" CHECK(length(trim("gmail_recovery_thread"."gmail_thread_id")) > 0),
	CONSTRAINT "gmail_recovery_thread_status_valid" CHECK("gmail_recovery_thread"."status" in ('pending', 'reconciled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_recovery_thread_workspace_id_id_unique` ON `gmail_recovery_thread` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_recovery_thread_generation_gmail_unique` ON `gmail_recovery_thread` (`generation_id`,`gmail_thread_id`);--> statement-breakpoint
CREATE INDEX `gmail_recovery_thread_workspace_generation_status_idx` ON `gmail_recovery_thread` (`workspace_id`,`generation_id`,`status`);