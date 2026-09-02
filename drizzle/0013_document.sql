CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'resume' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_name_not_blank" CHECK(length(trim("document"."name")) > 0),
	CONSTRAINT "document_kind_valid" CHECK("document"."kind" in ('resume', 'cover_letter', 'transcript', 'degree_certificate', 'portfolio', 'research_cv', 'writing_sample', 'generic'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_workspace_id_id_unique` ON `document` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_workspace_name_unique` ON `document` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `document_workspace_kind_idx` ON `document` (`workspace_id`,`kind`);--> statement-breakpoint
CREATE TABLE `document_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`version_id`) REFERENCES `document_version`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_usage_entity_type_valid" CHECK("document_usage"."entity_type" in ('application'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_usage_workspace_id_id_unique` ON `document_usage` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_usage_workspace_link_unique` ON `document_usage` (`workspace_id`,`version_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `document_usage_workspace_version_idx` ON `document_usage` (`workspace_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `document_usage_workspace_entity_idx` ON `document_usage` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `document_version` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`document_id` text NOT NULL,
	`label` text NOT NULL,
	`storage_key` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_type` text NOT NULL,
	`original_filename` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`document_id`) REFERENCES `document`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_version_label_not_blank" CHECK(length(trim("document_version"."label")) > 0),
	CONSTRAINT "document_version_storage_key_not_blank" CHECK(length(trim("document_version"."storage_key")) > 0),
	CONSTRAINT "document_version_sha256_hex" CHECK(length("document_version"."sha256") = 64 and "document_version"."sha256" glob '[0-9a-f]*'),
	CONSTRAINT "document_version_byte_size_positive" CHECK("document_version"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_version_workspace_id_id_unique` ON `document_version` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_version_workspace_label_unique` ON `document_version` (`workspace_id`,`document_id`,`label`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_version_storage_key_unique` ON `document_version` (`storage_key`);--> statement-breakpoint
CREATE INDEX `document_version_workspace_document_idx` ON `document_version` (`workspace_id`,`document_id`);