CREATE TABLE `opportunity_contact` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`opportunity_id`) REFERENCES `opportunity`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`contact_id`) REFERENCES `contact`(`workspace_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_contact_workspace_id_id_unique` ON `opportunity_contact` (`workspace_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `opportunity_contact_workspace_pair_unique` ON `opportunity_contact` (`workspace_id`,`opportunity_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `opportunity_contact_workspace_opportunity_idx` ON `opportunity_contact` (`workspace_id`,`opportunity_id`);--> statement-breakpoint
CREATE INDEX `opportunity_contact_workspace_contact_idx` ON `opportunity_contact` (`workspace_id`,`contact_id`);