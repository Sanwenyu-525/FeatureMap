/**
 * FeatureContext model — the AI Context Layer (Phase 5).
 *
 * A FeatureContext is a **projection** of the Feature Knowledge Graph,
 * never a second source of truth (AGENTS.md §15: when choosing between
 * a clever abstraction and an explainable evidence path, choose the
 * evidence path). Every entry carries deterministic evidence that points
 * back to the graph rows it was derived from.
 *
 * The builder is format-agnostic: it produces this structured model and
 * renderers (markdown / json / agent) format it for human or machine
 * consumers. CLI, MCP, IDE and HTTP API all call the same
 * `buildFeatureContext` API.
 */

export const CONTEXT_SCHEMA_VERSION = '1';

/** Builder version — bumped when ranking/budget rules change. */
export const CONTEXT_BUILDER_VERSION = '0.1.0';

export type ContextFormat = 'markdown' | 'json' | 'agent';

/** Relation status that may enter a context (rejected/superseded never do). */
export type ContextRelationStatus = 'declared' | 'suggested' | 'accepted';

/**
 * Caller options. Future consumers (CLI / MCP / VS Code / GitHub / HTTP)
 * map their own option surfaces onto this one.
 */
export interface ContextOptions {
  /** Token budget for the included content. Default: 8000. */
  budget?: number;
  /** Requested output format; default 'markdown'. */
  format?: ContextFormat;
  /**
   * Task-aware context. Only changes RANKING — it never mutates the
   * Feature Knowledge Graph (rule-based term boost; no LLM required).
   */
  task?: string;
  /** Include the recent-changes section. Default: true. */
  includeHistory?: boolean;
  /** Include the tests section. Default: true. */
  includeTests?: boolean;
  /** Relational traversal depth used for dependency expansion. Default: 3. */
  depth?: number;
  /** Override the store path (used by tests and embedded consumers). */
  dbPath?: string;
}

export type ContextTier = 1 | 2 | 3 | 4;

/**
 * Deterministic provenance. `origin` mirrors the graph's evidence
 * origin; `confidence` follows docs/DATA_MODEL.md §4. This is what lets
 * any consumer answer "why does the system believe this?".
 */
export interface ContextEvidence {
  analyzerId: string;
  origin: 'deterministic' | 'semantic' | 'manual';
  confidence: number;
  relationType?: string;
  sourceId?: string;
  targetId?: string;
  /** Short human reason, e.g. "changed symbol in owned file" or "chain: IMPORTS→CALLS". */
  note?: string;
}

export type ContextRole = 'anchor' | 'owns' | 'DEPENDS_ON';

/**
 * One ranked code item: an owned file/symbol, a dependency, a dependent,
 * an entry point, or a test asset. `kind` mirrors asset type
 * ('file' | 'symbol' | 'endpoint' | 'cli_command' | 'data_entity' | 'test').
 */
export interface CodeEntry {
  /** Stable id: candidate targetId, asset id, or a synthetic `F:<path>` / `S:<path>:<name>`. */
  id: string;
  kind: string;
  file?: string;
  /** Symbol name when symbol-level. */
  name?: string;
  /** Source-code kind (function / class / method / component / …) when known. */
  symbolType?: string;
  /** Line span (`path:start-end`) when known — a code anchor without file content. */
  span?: string;
  role: ContextRole;
  status?: ContextRelationStatus;
  isAnchor: boolean;
  /** Relational hops from the nearest anchor. */
  distance: number;
  /** Whole-repository in-degree over relational edges. */
  fanIn: number;
  /** Composite deterministic ranking score (0..1+task boosts). */
  score: number;
  tier: ContextTier;
  /** Ownership confidence (feature_assets or candidate score). */
  confidence: number;
  /** Human-readable relation notes, e.g. 'IMPORTS auth-service.ts'. */
  relations: string[];
  evidence: ContextEvidence[];
  estimatedTokens: number;
  /** True when this item moved in the recent-changes window. */
  recent?: boolean;
  /** True when this item matched the task terms (task-aware ranking). */
  taskMatched?: boolean;
}

export interface RecentChangeEntry {
  sha: string;
  author: string;
  committedAt?: string;
  message?: string;
  /** Conventional-commit kind (feat/fix/docs/…). */
  kind: string;
  changedPaths: string[];
  /** True when the commit message matched task terms. */
  taskMatched?: boolean;
  estimatedTokens: number;
  evidence: ContextEvidence[];
}

export type RiskBand = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Deterministic, explainable risk signal derived from recent changes —
 * same band style as ADR-0005 §2, never an opaque percentage
 * (AGENTS.md §7).
 */
export interface RiskSignal {
  id: string;
  band: RiskBand;
  reason: string;
  estimatedTokens: number;
  evidence: ContextEvidence[];
}

/** Repository instruction applicable to this feature (docs/DATA_MODEL.md §2). */
export interface PolicyEntry {
  id: string;
  text: string;
  level: 'required' | 'recommended' | 'informational';
  scope?: string;
  /** Source document path. */
  source: string;
  documentType: string;
  estimatedTokens: number;
  evidence: ContextEvidence[];
}

export interface FeatureContextBudget {
  /** Requested token budget (options.budget or default). */
  requested: number;
  /** Sum of estimatedTokens of every included entry. */
  estimatedTotal: number;
  /** Tokens allocated per section before selection (importance-weighted). */
  allocation: Record<string, number>;
  /** True when the budget bound was hit and at least one entry was dropped. */
  overBudget: boolean;
  /** Ids of entries excluded by the budget (explicit, never silent). */
  dropped: string[];
  /** Sections whose budget was exhausted; helpful for tuning. */
  exhaustedSections: string[];
}

export interface FeatureContext {
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  feature: {
    id: string;
    name: string;
    description?: string;
    pattern: string;
    status: string;
    confidence: number;
    health?: Record<string, string>;
  };
  /** One-line purpose; derived deterministically from description/anchors. */
  purpose?: string;
  /** One-line summary of the projection (counts of what is included). */
  summary?: string;
  /** API/CLI/anchor entry points — always Tier 1. */
  entryPoints: CodeEntry[];
  /** The feature's own implementation (owns relations + data entities). */
  coreCode: CodeEntry[];
  /** Verbs of what this feature depends on (DEPENDS_ON). */
  dependencies: CodeEntry[];
  /** Reverse impact: code that imports/uses this feature's core. */
  dependents: CodeEntry[];
  tests: CodeEntry[];
  /** Repository rules that apply to this feature (required/recommended/informational). */
  policies: PolicyEntry[];
  /** Constraining rules (required level) — a projection of policies. */
  constraints: PolicyEntry[];
  recentChanges: RecentChangeEntry[];
  changeRisks: RiskSignal[];
  /** Consolidated evidence summary (deduplicated, most confident first). */
  evidence: ContextEvidence[];
  budget: FeatureContextBudget;
  task?: {
    text: string;
    terms: string[];
    /** Number of entries that received a task boost. */
    boostsApplied: number;
  };
  generatedBy: {
    builder: 'featuremap-context';
    version: string;
    format: ContextFormat;
    options: {
      budget: number;
      depth: number;
      includeHistory: boolean;
      includeTests: boolean;
    };
    timestamp: string;
  };
  /** Items dropped by the budget, rendered as explicit truncation (never silent). */
  truncationNote?: string;
}