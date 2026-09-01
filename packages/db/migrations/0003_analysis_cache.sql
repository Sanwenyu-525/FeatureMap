CREATE TABLE `analysis_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
