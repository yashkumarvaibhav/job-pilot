CREATE TABLE `saved_search` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`entity_type` text NOT NULL,
	`query` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "saved_search_name_not_blank" CHECK(length(trim("saved_search"."name")) > 0),
	CONSTRAINT "saved_search_entity_type_valid" CHECK("saved_search"."entity_type" in ('contacts', 'opportunities', 'referrals'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_search_workspace_id_id_unique` ON `saved_search` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saved_search_workspace_name_unique` ON `saved_search` (`workspace_id`,`name`);--> statement-breakpoint
CREATE INDEX `saved_search_workspace_entity_idx` ON `saved_search` (`workspace_id`,`entity_type`);
