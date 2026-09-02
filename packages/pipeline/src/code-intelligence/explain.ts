/**
 * Explain a Feature↔symbol relation (v0.6.2 plan §4.4 / Phase G).
 *
 * Reuses `explainCandidate` (the canonical evidence chain) and never
 * re-implements explanation. A confirmed `feature_assets` relation that
 * has no candidate row falls back to the stored evidence rows touching
 * the symbol (deterministic, evidence-backed — AGENTS.md §15).
 */
import { eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { explainCandidate, ReviewError } from '../review.js';

export interface ExplainChainStep {
  relationType: string;
  sourceId: string;
  targetId: string;
  confidence: number;
}

export interface ExplainFeatureRelationResult {
  featureId: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  relation: 'owns' | 'DEPENDS_ON';
  status: string;
  confidence: number;
  chain: ExplainChainStep[];
}

export function explainFeatureRelation(
  repoRoot: string,
  featureId: string,
  target: string,
  dbPathOverride?: string,
): ExplainFeatureRelationResult {
  // Candidate targetIds are `<path>:<name>`; accept `symbol:`-prefixed too.
  const stripped = target.replace(/^symbol:/, '');
  try {
    const r = explainCandidate(repoRoot, featureId, stripped, dbPathOverride);
    return {
      featureId: r.featureId,
      targetId: r.targetId,
      targetType: r.targetType,
      relation: r.relation,
      status: r.status,
      confidence: r.score,
      chain: r.chain,
    };
  } catch (err) {
    if (err instanceof ReviewError && err.code === 'CANDIDATE_NOT_FOUND') {
      // Confirmed feature_assets relation: expose the stored evidence
      // touching this symbol as the explanation.
      const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
      try {
        const chain = db
          .select()
          .from(schema.evidence)
          .where(eq(schema.evidence.targetId, `symbol:${stripped}`))
          .all()
          .slice(0, 10)
          .map((e) => ({
            relationType: e.relationType,
            sourceId: e.sourceId,
            targetId: e.targetId,
            confidence: e.confidence,
          }));
        return {
          featureId,
          targetId: stripped,
          targetType: 'symbol',
          relation: 'owns',
          status: 'confirmed',
          confidence: 1.0,
          chain,
        };
      } finally {
        sqlite.close();
      }
    }
    throw err;
  }
}
