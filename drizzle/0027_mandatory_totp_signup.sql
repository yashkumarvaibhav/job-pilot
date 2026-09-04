ALTER TABLE `user_account` ADD COLUMN `signup_completed_at` integer;
--> statement-breakpoint
UPDATE `user_account`
SET `signup_completed_at` = `created_at`
WHERE `signup_completed_at` IS NULL;
