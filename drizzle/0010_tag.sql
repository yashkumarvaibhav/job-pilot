CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`label` text NOT NULL,
	`label_normalized` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tag_label_not_blank" CHECK(length(trim("tag"."label")) > 0),
	CONSTRAINT "tag_label_normalized_not_blank" CHECK(length(trim("tag"."label_normalized")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_workspace_id_id_unique` ON `tag` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_workspace_label_unique` ON `tag` (`workspace_id`,`label_normalized`);--> statement-breakpoint
CREATE INDEX `tag_workspace_label_idx` ON `tag` (`workspace_id`,`label_normalized`);--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`tag_id`) REFERENCES `tag`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "entity_tag_entity_type_valid" CHECK("entity_tag"."entity_type" in ('company', 'contact', 'opportunity')),
	CONSTRAINT "entity_tag_entity_id_not_blank" CHECK(length(trim("entity_tag"."entity_id")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_tag_workspace_id_id_unique` ON `entity_tag` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_tag_workspace_link_unique` ON `entity_tag` (`workspace_id`,`tag_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `entity_tag_workspace_entity_idx` ON `entity_tag` (`workspace_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `entity_tag_workspace_tag_idx` ON `entity_tag` (`workspace_id`,`tag_id`);