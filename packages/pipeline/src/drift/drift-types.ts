/**
 * Drift types (v0.6.4 plan §3).
 *
 * Deterministic, ADR-0005 mapping-drift signals shared by the PR report
 * and the IDE diagnostics — one rule set, never two (plan §1.2).
 */
export type DriftKind = 'relation_broken' | 'new_candidate';

export interface DriftIssue {
  /** Deterministic id (kind + feature + target) so Problems don't flicker. */
  id: string;
  kind: DriftKind;
  featureId: string;
  featureName?: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  reason: string;
  /** 1-based; set by the pipeline entry (`detectDrift`), absent for PR consumers. */
  location?: { filePath: string; startLine: number; endLine?: number };
  candidate?: { fingerprint?: string; status?: string; score?: number };
}

export interface DriftSummary {
  issueCount: number;
  byType: Record<DriftKind, number>;
}

export interface DriftReport {
  issues: DriftIssue[];
  summary: DriftSummary;
}
