/**
 * Change impact traversal — Milestone 4 (docs/DEVELOPMENT_PLAN.md).
 *
 * `featuremap impact` starts from Git changes and traverses ONLY
 * evidence-backed relations (AGENTS.md §9). Low-confidence hits are
 * surfaced as uncertainty, never as definite impact.
 *
 * Traversal (all hops backed by stored evidence):
 *   1. Direct: changed file → BELONGS_TO_FEATURE (feature_assets row)
 *   2. Reverse: changed file ← IMPORTS (dependents) → BELONGS_TO_FEATURE
 *      (one transitive hop, penalised confidence)
 */
import { eq, or, sql } from 'drizzle-orm';
import { isSurfaceable, loadConfig } from '@featuremap/core';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';

export interface AffectedFeature {
  featureId: string;
  featureName: string;
  confidence: number;
  reasons: string[];
  tests: string[];
  documents: string[];
}

export interface ImpactResult {
  changedFiles: Array<{ path: string; changeType: string; commitSha: string }>;
  /** Ranked by confidence; below-threshold evidence is excluded. */
  affectedFeatures: AffectedFeature[];
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
  currentBranch?: string;
  baseBranch?: string;
}

/** Confidence penalties per traversal distance (docs/DATA_MODEL.md §4). */
const DIRECT_CONFIDENCE = 1.0;
const TRANSITIVE_CONFIDENCE = 0.8;

export function analyzeImpact(repoRoot: string, dbPathOverride?: string): ImpactResult {
  const config = loadConfig(repoRoot).config;
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    // Current change set: working tree + branch diff (evidence-backed via
    // MODIFIED_BY rows persisted by the scan).
    const changedFileRows = db
      .select()
      .from(schema.commitFiles)
      .where(or(eq(schema.commitFiles.commitSha, 'WORKING_TREE'), eq(schema.commitFiles.commitSha, 'BRANCH_DIFF')))
      .all();

    const changedFiles = changedFileRows.map((c) => ({
      path: c.path,
      changeType: c.changeType,
      commitSha: c.commitSha,
    }));
    const changedPaths = new Set(changedFiles.map((c) => c.path));

    // Feature membership: featureId → asset paths with confidence.
    const membership = new Map<string, { path: string; confidence: number }[]>();
    for (const fa of db.select().from(schema.featureAssets).all()) {
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
      if (!asset?.path) continue;
      if (!membership.has(fa.featureId)) membership.set(fa.featureId, []);
      membership.get(fa.featureId)!.push({ path: asset.path, confidence: fa.confidence });
    }

    // Reverse IMPORTS index: imported file → importing files.
    const dependents = new Map<string, string[]>();
    for (const ev of db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.relationType, 'IMPORTS'))
      .all()) {
      if (!dependents.has(ev.targetId)) dependents.set(ev.targetId, []);
      dependents.get(ev.targetId)!.push(ev.sourceId);
    }

    const features = new Map(db.select().from(schema.features).all().map((f) => [f.id, f]));
    const scores = new Map<string, { confidence: number; reasons: Set<string> }>();

    const bump = (featureId: string, confidence: number, reason: string): void => {
      const current = scores.get(featureId);
      if (current) {
        current.confidence = Math.max(current.confidence, confidence);
        current.reasons.add(reason);
      } else {
        scores.set(featureId, { confidence, reasons: new Set([reason]) });
      }
    };

    for (const changed of changedPaths) {
      // Hop 1 — direct membership.
      for (const [featureId, entries] of membership) {
        for (const entry of entries) {
          if (entry.path !== changed) continue;
          const confidence = Math.min(entry.confidence, DIRECT_CONFIDENCE);
          bump(featureId, confidence, `${entry.path} belongs to this feature (${entry.confidence})`);
        }
      }
      // Hop 2 — reverse imports (files that depend on the changed file).
      for (const dependent of dependents.get(changed) ?? []) {
        for (const [featureId, entries] of membership) {
          for (const entry of entries) {
            if (entry.path !== dependent) continue;
            const confidence = Math.min(entry.confidence, TRANSITIVE_CONFIDENCE);
            bump(
              featureId,
              confidence,
              `${dependent} imports ${changed} (${TRANSITIVE_CONFIDENCE} transitive)`,
            );
          }
        }
      }
    }

    // Rank and surface; below-threshold evidence stays internal
    // (docs/DATA_MODEL.md §4).
    const affectedFeatures: AffectedFeature[] = [...scores.entries()]
      .filter(([, s]) => isSurfaceable(s.confidence))
      .sort((a, b) => b[1].confidence - a[1].confidence)
      .flatMap(([featureId, s]) => {
        const feature = features.get(featureId);
        if (!feature) return [];
        const health = (feature.health ?? {}) as Record<string, string>;
        const featureDocs = db
          .select()
          .from(schema.featureDocuments)
          .where(eq(schema.featureDocuments.featureId, featureId))
          .all()
          .map((fd) => fd.documentId);
        const featureTests =
          health['tests'] === 'present'
            ? db
                .select()
                .from(schema.featureAssets)
                .where(eq(schema.featureAssets.featureId, featureId))
                .all()
                .flatMap((fa) => {
                  const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
                  return asset?.type === 'test' && asset.path ? [asset.path] : [];
                })
            : [];
        return [
          {
            featureId,
            featureName: feature.name,
            confidence: s.confidence,
            reasons: [...s.reasons],
            tests: featureTests,
            documents: featureDocs,
          },
        ];
      });

    // Documentation drift: a changed file described by a document
    // suggests the document may now be stale (deterministic DESCRIBED_BY).
    const staleDocs = new Map<string, string>();
    for (const ev of db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.relationType, 'DESCRIBED_BY'))
      .all()) {
      if (!changedPaths.has(ev.sourceId)) continue;
      const reason = `${ev.sourceId} changed and is described by this document`;
      const existing = staleDocs.get(ev.targetId);
      staleDocs.set(ev.targetId, existing ? `${existing}; ${reason}` : reason);
    }

    const scanRow = db
      .select()
      .from(schema.scans)
      .orderBy(sql`started_at desc`)
      .limit(1)
      .all()[0];
    const stats = (scanRow?.stats ?? {}) as { currentBranch?: string };

    return {
      changedFiles,
      affectedFeatures,
      potentiallyStaleDocuments: [...staleDocs.entries()].map(([path, reason]) => ({ path, reason })),
      currentBranch: stats.currentBranch,
      baseBranch: config?.scan.baseBranch,
    };
  } finally {
    sqlite.close();
  }
}
