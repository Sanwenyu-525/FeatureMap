CREATE TABLE `feature_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`relation` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`distance` integer DEFAULT 0 NOT NULL,
	`fan_in` integer DEFAULT 0 NOT NULL,
	`evidence_chain` text DEFAULT '[]' NOT NULL,
	`fingerprint` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_candidates_uq` ON `feature_candidates` (`feature_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `feature_candidates_feature_idx` ON `feature_candidates` (`feature_id`,`status`);