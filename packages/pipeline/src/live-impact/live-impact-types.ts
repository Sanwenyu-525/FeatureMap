/**
 * Live Change Impact types (v0.6.3 plan §4–§5).
 *
 * A `CurrentImpactSnapshot` is a deterministic DTO over the existing
 * `analyzeImpact(WORKING_TREE)` result — never a second severity model
 * (ADR-0004 §3: HIGH/MEDIUM/LOW only, no percentages) and never a
 * second impact engine.
 */
import type {
  ImpactSeverity,
  RecommendedTest,
  SharedInfrastructureChange,
  SuppressedUncertainty,
} from '../impact.js';

export interface CurrentAffectedFeature {
  featureId: string;
  name: string;
  severity: ImpactSeverity;
  /** Reused verbatim from analyzeImpact; the UI must not re-derive them. */
  reasons: string[];
  tests: string[];
  documents: string[];
}

export interface CurrentImpactSummary {
  /** MUST equal affectedFeatures.length — never a weight conversion. */
  affectedFeatureCount: number;
  bySeverity: Record<ImpactSeverity, number>;
  recommendedTestCount: number;
  hasSharedInfrastructureImpact: boolean;
  suppressedUncertaintyCount: number;
}

export interface CurrentImpactSnapshot {
  repoRoot: string;
  generation: number;
  refreshedAt: string;
  trigger: { type: 'save' | 'manual' | 'scan'; savedFiles: string[] };
  summary: CurrentImpactSummary;
  changedFiles: Array<{ path: string; changeType: string }>;
  affectedFeatures: CurrentAffectedFeature[];
  sharedInfrastructure: SharedInfrastructureChange[];
  recommendedTests: RecommendedTest[];
  suppressedUncertainty: SuppressedUncertainty[];
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
}
