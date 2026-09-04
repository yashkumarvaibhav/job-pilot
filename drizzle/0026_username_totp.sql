ALTER TABLE `user_account` RENAME COLUMN `email_normalized` TO `username_normalized`;
--> statement-breakpoint
ALTER TABLE `user_account` ADD COLUMN `totp_secret_blob` text;
--> statement-breakpoint
ALTER TABLE `user_account` ADD COLUMN `totp_enabled_at` integer;
--> statement-breakpoint
ALTER TABLE `user_account` ADD COLUMN `totp_last_used_counter` integer;
