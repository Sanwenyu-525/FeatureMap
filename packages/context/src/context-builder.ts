/**
 * ContextBuilder — orchestrates the whole Phase 5 pipeline:
 *
 *   resolve (read graph facts) → rank (tier + task-aware boost)
 *   → budget (importance-weighted token selection) → assemble
 *
 * The builder is format-agnostic and consumer-agnostic: CLI, MCP, IDE,
 * GitHub integration and HTTP API all call `buildFeatureContext` with a
 * `ContextOptions` and render the resulting model themselves. The
 * builder never writes to the graph — a FeatureContext is a read-only
 * projection (docs/context/FEATURE_CONTEXT_SCHEMA.md).
 */
import { openDatabase, defaultDatabasePath, type FeatureMapDatabase } from '@featuremap/db';
import {
  CONTEXT_BUILDER_VERSION,
  CONTEXT_SCHEMA_VERSION,
  type ContextEvidence,
  type ContextOptions,
  type FeatureContext,
} from './types.js';
import { resolveFacts, resolveFeatureRow, FeatureContextError } from './context-resolver.js';
import { rankFacts } from './context-ranker.js';
import { applyBudget, DEFAULT_CONTEXT_BUDGET, type BudgetedContext } from './context-budget.js';
import { estimateTokens } from './tokens.js';

/** Default traversal depth for dependency expansion. */
export const DEFAULT_CONTEXT_DEPTH = 3;

export interface ContextInput {
  repoRoot: string;
  featureNameOrId: string;
  options?: ContextOptions;
}

/**
 * Build a FeatureContext for one feature (or a task) from the existing
 * Feature Knowledge Graph.
 *
 * Throws `FeatureContextError` (code `FEATURE_NOT_FOUND`) when the
 * feature is unknown, mirroring the rest of the CLI surface.
 */
export function buildFeatureContext(
  repoRoot: string,
  featureNameOrId: string,
  options: ContextOptions = {},
): FeatureContext {
  const dbPath = options.dbPath ?? defaultDatabasePath(repoRoot);
  const { db, sqlite } = openDatabase(dbPath);
  try {
    return assembleContext(db, featureNameOrId, options);
  } finally {
    sqlite.close();
  }
}

/** Build a context from an already-open database (embedded consumers). */
export function assembleContext(
  db: FeatureMapDatabase,
  featureNameOrId: string,
  options: ContextOptions = {},
): FeatureContext {
  const feature = resolveFeatureRow(db, featureNameOrId);
  const facts = resolveFacts(db, feature);
  const ranked = rankFacts(facts, { task: options.task, depth: options.depth ?? DEFAULT_CONTEXT_DEPTH });
  const budgeted = applyBudget(ranked, {
    budget: options.budget,
    includeHistory: options.includeHistory,
    includeTests: options.includeTests,
  });
  return toFeatureContext(feature, budgeted, options);
}

/** Compose the final model: purpose/summary/evidence metadata. */
function toFeatureContext(
  feature: FeatureContext['feature'],
  budgeted: BudgetedContext,
  options: ContextOptions,
): FeatureContext {
  const { entryPoints, coreCode, dependencies, dependents, tests, policies, constraints, recentChanges, changeRisks, budget } = budgeted;

  const purpose = computePurpose(feature, entryPoints);
  const summary = composeSummary(budgeted, feature.name);
  const evidence = consolidateEvidence(budgeted);

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    feature,
    purpose,
    summary,
    entryPoints,
    coreCode,
    dependencies,
    dependents,
    tests,
    policies,
    constraints,
    recentChanges,
    changeRisks,
    evidence,
    budget,
    task: budgeted.task,
    generatedBy: {
      builder: 'featuremap-context',
      version: CONTEXT_BUILDER_VERSION,
      format: options.format ?? 'markdown',
      options: {
        budget: Math.round(options.budget ?? DEFAULT_CONTEXT_BUDGET),
        depth: options.depth ?? DEFAULT_CONTEXT_DEPTH,
        includeHistory: options.includeHistory ?? true,
        includeTests: options.includeTests ?? true,
      },
      timestamp: new Date().toISOString(),
    },
    truncationNote: budgeted.truncationNote,
  };
}

/**
 * Deterministic purpose line: explicit description wins; otherwise the
 * pattern plus the entry-point names form the sentence. Never an LLM
 * guess (AGENTS.md §3.2 — LLM is optional for naming, never the base).
 */
function computePurpose(
  feature: FeatureContext['feature'],
  entryPoints: FeatureContext['entryPoints'],
): string | undefined {
  if (feature.description && feature.description.trim().length > 0) {
    return feature.description.trim();
  }
  const entries = entryPoints.map((e) => e.name ?? e.file ?? e.id).filter(Boolean);
  if (entries.length === 0) return undefined;
  return `${feature.name}（${feature.pattern}）：${entries.slice(0, 3).join('、')}${entries.length > 3 ? ' 等入口' : ''}。`;
}

/** One-line summary of the projection, built from the selected content. */
function composeSummary(budgeted: BudgetedContext, featureName: string): string {
  const owned = budgeted.coreCode.filter((e) => e.role === 'owns').length;
  const parts = [
    `${budgeted.entryPoints.length} 入口`,
    `${owned} 核心文件/符号`,
    `${budgeted.dependencies.length} 依赖`,
    `${budgeted.tests.length} 测试`,
    `${budgeted.dependents.length} 下游依赖方`,
    `${budgeted.policies.length} 约束/规则`,
    `${budgeted.recentChanges.length} 近期提交`,
  ];
  return `${featureName}：${parts.join('，')}（预算 ${budgeted.budget.requested} tokens，实际估算 ${budgeted.budget.estimatedTotal}）。`;
}

/** Consolidated, deduplicated evidence across all included entries. */
function consolidateEvidence(budgeted: BudgetedContext): ContextEvidence[] {
  const seen = new Set<string>();
  const out: ContextEvidence[] = [];
  const push = (e: ContextEvidence): void => {
    const key = `${e.analyzerId}|${e.relationType ?? ''}|${e.sourceId ?? ''}|${e.targetId ?? ''}|${e.confidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  for (const entry of [
    ...budgeted.entryPoints,
    ...budgeted.coreCode,
    ...budgeted.dependencies,
    ...budgeted.dependents,
    ...budgeted.tests,
  ]) {
    for (const e of entry.evidence) push(e);
  }
  for (const c of budgeted.recentChanges) for (const e of c.evidence) push(e);
  for (const r of budgeted.changeRisks) for (const e of r.evidence) push(e);
  for (const p of budgeted.policies) for (const e of p.evidence) push(e);
  out.sort((a, b) => b.confidence - a.confidence || a.analyzerId.localeCompare(b.analyzerId));
  return out.slice(0, 40);
}

/** Re-export the resolver error so consumers can catch it by class. */
export { FeatureContextError };

/** Token estimate for the final rendered text (informational). */
export function estimateRenderedTokens(context: FeatureContext): number {
  return estimateTokens(JSON.stringify(context));
}