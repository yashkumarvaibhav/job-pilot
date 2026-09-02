DROP INDEX `opportunity_workspace_company_job_id_unique`;--> statement-breakpoint
CREATE INDEX `opportunity_workspace_company_job_id_idx` ON `opportunity` (`workspace_id`,`company_id`,`job_id`);