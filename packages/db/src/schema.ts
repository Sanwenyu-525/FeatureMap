/**
 * SQLite schema — docs/DATA_MODEL.md §6.
 *
 * The source of truth is the evidence-backed graph, so the generic
 * `evidence` table is central; the convenience join tables
 * (feature_assets / feature_documents / feature_instructions) are
 * derived indexes for feature-level queries.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  root: text('root').notNull().unique(),
  baseBranch: text('base_branch').notNull().default('main'),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});

export const scans = sqliteTable('scans', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['incremental', 'full'] }).notNull().default('incremental'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  startedAt: text('started_at').notNull().default(sql`(current_timestamp)`),
  finishedAt: text('finished_at'),
  stats: text('stats', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    hash: text('hash'),
    language: text('language'),
    size: integer('size'),
    mtimeMs: integer('mtime_ms'),
    lastSeenScanId: text('last_seen_scan_id'),
  },
  (t) => [uniqueIndex('files_project_path_uq').on(t.projectId, t.path)],
);

export const symbols = sqliteTable(
  'symbols',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    startLine: integer('start_line'),
    endLine: integer('end_line'),
  },
  (t) => [index('symbols_file_idx').on(t.fileId)],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    type: text('type', {
      enum: ['file', 'symbol', 'component', 'endpoint', 'data_entity', 'test', 'cli_command'],
    }).notNull(),
    path: text('path'),
    name: text('name'),
    language: text('language'),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  },
  (t) => [index('assets_type_idx').on(t.type)],
);

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  type: text('type', {
    enum: ['readme', 'agents', 'claude', 'contributing', 'adr', 'docs', 'config', 'other'],
  }).notNull(),
  title: text('title'),
});

export const instructions = sqliteTable(
  'instructions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    scope: text('scope'),
    level: text('level', { enum: ['required', 'recommended', 'informational'] })
      .notNull()
      .default('informational'),
    confidence: real('confidence').notNull().default(1.0),
  },
  (t) => [index('instructions_document_idx').on(t.documentId)],
);

/**
 * Generic evidence table — the source of truth. Every inferred relation
 * must carry source, target, relation type, confidence and analyzer
 * identity (AGENTS.md §6).
 */
export const evidence = sqliteTable(
  'evidence',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    relationType: text('relation_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    confidence: real('confidence').notNull(),
    analyzerId: text('analyzer_id').notNull(),
    origin: text('origin', { enum: ['deterministic', 'semantic', 'manual'] }).notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    scanId: text('scan_id'),
  },
  (t) => [
    index('evidence_source_idx').on(t.sourceType, t.sourceId),
    index('evidence_target_idx').on(t.targetType, t.targetId),
    index('evidence_relation_idx').on(t.relationType),
  ],
);

export const features = sqliteTable('features', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  parentId: text('parent_id'),
  pattern: text('pattern', {
    enum: ['Authentication', 'CRUD', 'Workflow', 'Event', 'Pipeline', 'Generic'],
  })
    .notNull()
    .default('Generic'),
  confidence: real('confidence').notNull().default(0),
  status: text('status', { enum: ['active', 'merged', 'archived'] })
    .notNull()
    .default('active'),
  // Derived (never a free-form AI judgment): docs/DATA_MODEL.md §5.
  health: text('health', { mode: 'json' }).$type<Record<string, string>>(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
});

export const featureAssets = sqliteTable(
  'feature_assets',
  {
    featureId: text('feature_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    confidence: real('confidence').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.assetId] })],
);

export const featureDocuments = sqliteTable(
  'feature_documents',
  {
    featureId: text('feature_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    confidence: real('confidence').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.documentId] })],
);

export const featureInstructions = sqliteTable(
  'feature_instructions',
  {
    featureId: text('feature_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    instructionId: text('instruction_id')
      .notNull()
      .references(() => instructions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.featureId, t.instructionId] })],
);

/**
 * One evidence step in a candidate's derivation chain (ADR-0003 §2,
 * docs/releases/v0.2-acceptance.md §1: every suggestion must be
 * explainable).
 */
export interface CandidateEvidenceStep {
  relationType: string;
  sourceId: string;
  targetId: string;
  confidence: number;
}

/**
 * Candidate feature↔code relations produced by anchor-driven graph
 * traversal (ADR-0003 §3–4). Review state survives rescans: rescan
 * re-derives `suggested` rows but never overwrites `accepted` or
 * `rejected` verdicts.
 */
export const featureCandidates = sqliteTable(
  'feature_candidates',
  {
    id: text('id').primaryKey(),
    featureId: text('feature_id')
      .notNull()
      .references(() => features.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['file', 'symbol'] }).notNull(),
    targetId: text('target_id').notNull(),
    relation: text('relation', { enum: ['owns', 'DEPENDS_ON'] }).notNull(),
    status: text('status', {
      enum: ['declared', 'suggested', 'accepted', 'rejected', 'superseded'],
    })
      .notNull()
      .default('suggested'),
    score: real('score').notNull().default(0),
    /** Relational hops from the nearest anchor (0 = anchor itself). */
    distance: integer('distance').notNull().default(0),
    /** Whole-repository in-degree of the target over relational edges. */
    fanIn: integer('fan_in').notNull().default(0),
    evidenceChain: text('evidence_chain', { mode: 'json' })
      .$type<CandidateEvidenceStep[]>()
      .notNull()
      .default(sql`'[]'`),
    /** Hash of the evidence chain; verdict drift detection (v0.2-acceptance §4). */
    fingerprint: text('fingerprint'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    uniqueIndex('feature_candidates_uq').on(t.featureId, t.targetType, t.targetId),
    index('feature_candidates_feature_idx').on(t.featureId, t.status),
  ],
);

export const commits = sqliteTable(
  'commits',
  {
    sha: text('sha').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    author: text('author'),
    email: text('email'),
    message: text('message'),
    committedAt: text('committed_at'),
  },
  (t) => [index('commits_project_idx').on(t.projectId)],
);

export const commitFiles = sqliteTable(
  'commit_files',
  {
    commitSha: text('commit_sha')
      .notNull()
      .references(() => commits.sha, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    changeType: text('change_type', { enum: ['added', 'modified', 'deleted', 'renamed'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.commitSha, t.path] })],
);

/** One row per analyzer execution; supports error isolation reporting. */
export const analyzerRuns = sqliteTable('analyzer_runs', {
  id: text('id').primaryKey(),
  scanId: text('scan_id')
    .notNull()
    .references(() => scans.id, { onDelete: 'cascade' }),
  analyzerId: text('analyzer_id').notNull(),
  version: text('version').notNull(),
  status: text('status', { enum: ['ok', 'degraded', 'failed'] }).notNull(),
  startedAt: text('started_at').notNull().default(sql`(current_timestamp)`),
  finishedAt: text('finished_at'),
  diagnostics: text('diagnostics', { mode: 'json' }).$type<unknown[]>(),
});

/**
 * Manual corrections carry the highest authority
 * (docs/DATA_MODEL.md §7). Analyzer evidence is never destroyed when an
 * override exists.
 */
export const manualOverrides = sqliteTable('manual_overrides', {
  id: text('id').primaryKey(),
  action: text('action', {
    enum: ['add_relation', 'remove_relation', 'rename_feature', 'merge_feature'],
  }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});

/**
 * Cross-run per-file analysis cache (Milestone 9, docs/DEVELOPMENT_PLAN.md).
 * Key = analyzer id:version:file hash:file-set signature; payload is an
 * opaque analyzer-defined JSON blob. Entries are pruned when the file
 * set signature changes, so add/remove/deleted files degrade to a full
 * re-analysis instead of stale edges.
 */
export const analysisCache = sqliteTable('analysis_cache', {
  key: text('key').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});
