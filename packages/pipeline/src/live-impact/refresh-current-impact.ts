/**
 * Live Change Impact orchestration (v0.6.3 plan §3 / Phase A).
 *
 * `refreshCurrentImpact` is the save-triggered pipeline entry point:
 *
 *   savedFiles (incremental scan hint)
 *     → runScan (incremental, own hash/cache decides the real change set)
 *     → analyzeImpact(WORKING_TREE)   ← impact scope is the whole working tree
 *     → CurrentImpactSnapshot (cached with generation)
 *
 * The caller (IDE service) invalidates its read models (e.g.
 * SymbolFeatureIndex) after a successful refresh — the plan's §26
 * ordering: incremental scan → invalidate index → analyzeImpact.
 */
import { runScan } from '../scan-runner.js';
import { analyzeImpact, type ImpactResult } from '../impact.js';
import type { CurrentImpactStore } from './current-impact-store.js';
import { createCurrentImpactStore } from './current-impact-store.js';
import type { CurrentAffectedFeature, CurrentImpactSnapshot } from './live-impact-types.js';

export interface RefreshCurrentImpactInput {
  /** Hint for incremental scan; the scanner's hash/cache is authoritative. */
  savedFiles?: string[];
  trigger?: 'save' | 'manual' | 'scan';
  dbPath?: string;
}

export interface RefreshResult {
  snapshot: CurrentImpactSnapshot;
  refresh: { scannedFiles: number; changedFiles: number; durationMs: number };
}

function toAffectedFeatures(impact: ImpactResult): CurrentAffectedFeature[] {
  return impact.affectedFeatures.map((f) => ({
    featureId: f.featureId,
    name: f.featureName,
    severity: f.severity,
    reasons: f.reasons,
    tests: f.tests,
    documents: f.documents,
  }));
}

/**
 * Incrementally refresh the graph and derive the working-tree impact.
 * The snapshot is cached (repo-scoped, generation-guarded).
 */
export async function refreshCurrentImpact(
  repoRoot: string,
  input: RefreshCurrentImpactInput = {},
  store: CurrentImpactStore = createCurrentImpactStore(),
): Promise<RefreshResult> {
  const startedAt = Date.now();
  const { savedFiles = [], trigger = 'save', dbPath } = input;

  // 1. Incremental graph refresh (savedFiles is only an optimization
  // hint; the scanner's own hashing decides what actually changed).
  const scan = await runScan(repoRoot, { dbPath });

  // 2. Impact scope is the whole working tree (ADR-0004 §1 default:
  // working tree + branch diff), never just the saved files.
  const impact = await analyzeImpact(repoRoot, { dbPath });

  const affected = toAffectedFeatures(impact);
  const bySeverity: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of affected) bySeverity[f.severity] += 1;

  const snapshot: CurrentImpactSnapshot = {
    repoRoot,
    generation: 0, // assigned by the store
    refreshedAt: new Date().toISOString(),
    trigger: { type: trigger, savedFiles },
    summary: {
      affectedFeatureCount: affected.length,
      bySeverity,
      recommendedTestCount: impact.recommendedTests.length,
      hasSharedInfrastructureImpact: impact.sharedInfrastructure.length > 0,
      suppressedUncertaintyCount: impact.suppressedUncertainty.length,
    },
    changedFiles: impact.changedFiles.map((f) => ({ path: f.path, changeType: f.changeType })),
    affectedFeatures: affected,
    sharedInfrastructure: impact.sharedInfrastructure,
    recommendedTests: impact.recommendedTests,
    suppressedUncertainty: impact.suppressedUncertainty,
    potentiallyStaleDocuments: impact.potentiallyStaleDocuments,
  };

  return {
    snapshot: store.save(repoRoot, snapshot),
    refresh: {
      scannedFiles: scan.counts.changedFiles + scan.counts.cachedFiles,
      changedFiles: scan.counts.changedFiles,
      durationMs: Date.now() - startedAt,
    },
  };
}

/** Cheap read of the last snapshot (never triggers scan/analysis). */
export function getCurrentImpact(
  repoRoot: string,
  store: CurrentImpactStore,
): { available: boolean; snapshot?: CurrentImpactSnapshot } {
  const state = store.get(repoRoot);
  return state.snapshot ? { available: true, snapshot: state.snapshot } : { available: false };
}
