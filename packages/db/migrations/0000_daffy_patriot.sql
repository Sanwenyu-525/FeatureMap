CREATE TABLE `analyzer_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`analyzer_id` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	`diagnostics` text,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`path` text,
	`name` text,
	`language` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `assets_type_idx` ON `assets` (`type`);--> statement-breakpoint
CREATE TABLE `commit_files` (
	`commit_sha` text NOT NULL,
	`path` text NOT NULL,
	`change_type` text NOT NULL,
	PRIMARY KEY(`commit_sha`, `path`),
	FOREIGN KEY (`commit_sha`) REFERENCES `commits`(`sha`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `commits` (
	`sha` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`author` text,
	`email` text,
	`message` text,
	`committed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `commits_project_idx` ON `commits` (`project_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`type` text NOT NULL,
	`title` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_path_unique` ON `documents` (`path`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`confidence` real NOT NULL,
	`analyzer_id` text NOT NULL,
	`origin` text NOT NULL,
	`metadata` text,
	`scan_id` text
);
--> statement-breakpoint
CREATE INDEX `evidence_source_idx` ON `evidence` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `evidence_target_idx` ON `evidence` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `evidence_relation_idx` ON `evidence` (`relation_type`);--> statement-breakpoint
CREATE TABLE `feature_assets` (
	`feature_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`feature_id`, `asset_id`),
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_documents` (
	`feature_id` text NOT NULL,
	`document_id` text NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`feature_id`, `document_id`),
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_instructions` (
	`feature_id` text NOT NULL,
	`instruction_id` text NOT NULL,
	PRIMARY KEY(`feature_id`, `instruction_id`),
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instruction_id`) REFERENCES `instructions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` text,
	`pattern` text DEFAULT 'Generic' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`hash` text,
	`language` text,
	`size` integer,
	`mtime_ms` integer,
	`last_seen_scan_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_project_path_uq` ON `files` (`project_id`,`path`);--> statement-breakpoint
CREATE TABLE `instructions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`text` text NOT NULL,
	`scope` text,
	`level` text DEFAULT 'informational' NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `instructions_document_idx` ON `instructions` (`document_id`);--> statement-breakpoint
CREATE TABLE `manual_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`root` text NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_unique` ON `projects` (`root`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mode` text DEFAULT 'incremental' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` text DEFAULT (current_timestamp) NOT NULL,
	`finished_at` text,
	`stats` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `symbols` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`start_line` integer,
	`end_line` integer,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `symbols_file_idx` ON `symbols` (`file_id`);