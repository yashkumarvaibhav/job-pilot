CREATE TABLE `import_mapping` (
	`workspace_id` text NOT NULL,
	`entity_set` text NOT NULL,
	`mapping_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `entity_set`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_mapping_entity_set_valid" CHECK("import_mapping"."entity_set" in ('companies', 'contacts', 'opportunities'))
);
--> statement-breakpoint
CREATE INDEX `import_mapping_workspace_idx` ON `import_mapping` (`workspace_id`);