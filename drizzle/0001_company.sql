CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`careers_url` text,
	`industry` text,
	`type` text,
	`locations` text,
	`target` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "company_name_not_blank" CHECK(length(trim("company"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_workspace_id_id_unique` ON `company` (`workspace_id`,`id`);--> statement-breakpoint
CREATE INDEX `company_workspace_name_idx` ON `company` (`workspace_id`,`name`);