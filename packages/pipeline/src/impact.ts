/**
 * Change impact traversal — Milestone 4, extended for commit ranges in
 * Milestone 11 (ADR-0004 §1, docs/DEVELOPMENT_PLAN.md Milestone 11).
 *
 * `featuremap impact` starts from Git changes and traverses ONLY
 * evidence-backed relations (AGENTS.md §9). Low-confidence hits are
 * surfaced as uncertainty, never as definite impact.
 *
 * Traversal (all hops backed by stored evidence):
 *   1. Direct: changed file → BELONGS_TO_FEATURE (feature_assets row)
 *   2. Reverse: changed file ← IMPORTS (dependents) → BELONGS_TO_FEATURE
 *      (one transitive hop, penalised confidence)
 *
 * Change sources (ADR-0004 §1):
 *   no range          — working tree + branch diff (Milestone 4 behavior)
 *   `HEAD`            — HEAD~1..HEAD
 *   `A..B`            — arbitrary snapshot range, diff computed on demand
 *
 * For a commit range, changed files come from `git diff --name-status`
 * and changed symbols from hunk-lines ∩ scanned symbol spans, so the
 * reasons carry symbol-level detail (Milestone 11 exit criteria).
 */
import { eq, sql } from 'drizzle-orm';
import { isSurfaceable, loadConfig } from '@featuremap/core';
import { openDatabase, defaultDatabasePath, schema, type FeatureMapDatabase } from '@featuremap/db';
import {
  parseChangeSources,
  hunksForRange,
  filesForRange,
  extractChangedSymbols,
  type SymbolSpan,
} from './git/index.js';

export type ImpactSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AffectedFeature {
  featureId: string;
  featureName: string;
  confidence: number;
  /**
   * Severity band (ADR-0004 §3): HIGH = a changed symbol is owned by
   * the feature; MEDIUM = the feature DEPENDS_ON a changed file/symbol
   * (1 hop) or a changed file is in the closure without a symbol-level
   * match; LOW = other surfaceable hits. Bands are rule-based and every
   * feature keeps its reasons (AGENTS.md §7: no opaque percentages).
   */
  severity: ImpactSeverity;
  reasons: string[];
  tests: string[];
  documents: string[];
}

/** Shared infrastructure that must not be attributed to any feature (ADR-0004 §4). */
export interface SharedInfrastructureChange {
  path: string;
  changeType: string;
  dependentFeatureCount: number;
  reason: string;
}

/** Below-threshold hits surfaced as explicit uncertainty (ADR-0004 §3). */
export interface SuppressedUncertainty {
  featureId: string;
  featureName?: string;
  confidence: number;
  reason: string;
}

export interface ImpactResult {
  changedFiles: Array<{ path: string; changeType: string; commitSha: string }>;
  /** Ranked by severity then confidence; below-threshold evidence is excluded. */
  affectedFeatures: AffectedFeature[];
  /** Changed shared infrastructure (fan-in ≥ 3 features), not attributed. */
  sharedInfrastructure: SharedInfrastructureChange[];
  /** Hits that did not reach the surfaceable threshold, kept visible. */
  suppressedUncertainty: SuppressedUncertainty[];
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
  currentBranch?: string;
  baseBranch?: string;
}

/** Confidence penalties per traversal distance (docs/DATA_MODEL.md §4). */
const DIRECT_CONFIDENCE = 1.0;
const TRANSITIVE_CONFIDENCE = 0.8;

/**
 * Fan-in threshold for shared infrastructure (ADR-0004 §4, same
 * semantics as the ADR-0003 §5 fan-in penalty): a changed file depended
 * on by this many features is listed as shared infrastructure instead
 * of being attributed to any single feature.
 */
const SHARED_INFRA_FAN_IN = 3;

/**
 * Rule-based severity inference from the emission reasons (ADR-0004 §3).
 * HIGH requires a symbol-level match on a directly owned file; MEDIUM
 * covers direct closure hits and 1-hop DEPENDS_ON; LOW is the fallback
 * for other surfaceable hits.
 */
function severityOf(reasons: ReadonlySet<string>): ImpactSeverity {
  if ([...reasons].some((r) => r.includes('belongs to this feature') && r.includes('changed symbol(s)'))) {
    return 'HIGH';
  }
  if ([...reasons].some((r) => r.includes('belongs to this feature') || r.includes('imports'))) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export interface ImpactOptions {
  /** Commit range (ADR-0004 §1); omitted keeps working-tree + branch-diff. */
  range?: string;
  dbPath?: string;
}

export async function analyzeImpact(repoRoot: string, options: ImpactOptions = {}): Promise<ImpactResult> {
  const { range, dbPath: dbPathOverride } = options;
  const config = loadConfig(repoRoot).config;
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    // ---- Collect the change set from the requested sources --------------
    const changedFileRows: Array<{ path: string; changeType: string; commitSha: string }> = [];
    const changedSymbolsByPath = new Map<string, string[]>();
    for (const source of parseChangeSources(range)) {
      if (source.kind === 'working-tree' || source.kind === 'branch-diff') {
        const pseudoSha = source.kind === 'working-tree' ? 'WORKING_TREE' : 'BRANCH_DIFF';
        changedFileRows.push(
          ...db
            .select()
            .from(schema.commitFiles)
            .where(eq(schema.commitFiles.commitSha, pseudoSha))
            .all()
            .map((row) => ({ path: row.path, changeType: row.changeType, commitSha: row.commitSha })),
        );
      } else {
        // Commit range: native git diff on demand (ADR-0004 §1); diff
        // content is never persisted. Hunk lines ∩ symbol spans give
        // symbol-level reasons (Milestone 11).
        for (const file of await filesForRange(repoRoot, source.from, source.to)) {
          changedFileRows.push({
            path: file.path,
            changeType: file.changeType,
            commitSha: `${source.from}..${source.to}`,
          });
        }
        const spans = loadSymbolSpans(db);
        for (const sym of extractChangedSymbols(await hunksForRange(repoRoot, source.from, source.to), spans)) {
          const existing = changedSymbolsByPath.get(sym.path) ?? [];
          if (!existing.includes(sym.name)) existing.push(sym.name);
          changedSymbolsByPath.set(sym.path, existing);
        }
      }
    }

    const changedFiles = changedFileRows;
    const changedPaths = new Set(changedFiles.map((c) => c.path));
    const changedSymbolNote = (path: string): string | undefined => {
      const symbols = changedSymbolsByPath.get(path);
      return symbols && symbols.length > 0 ? `; changed symbol(s): ${symbols.join(', ')}` : undefined;
    };

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

    // path → owning feature ids (direct membership, for fan-in counting).
    const ownersByPath = new Map<string, string[]>();
    for (const [featureId, entries] of membership) {
      for (const entry of entries) {
        const list = ownersByPath.get(entry.path) ?? [];
        if (!list.includes(featureId)) list.push(featureId);
        ownersByPath.set(entry.path, list);
      }
    }

    // Shared infrastructure isolation (ADR-0004 §4): a changed file that
    // has no direct feature owner but is depended on by ≥ SHARED_INFRA_FAN_IN
    // features is listed separately and never attributed to a feature —
    // this is what keeps "Logger changed" from listing 47 features.
    const sharedInfrastructure: SharedInfrastructureChange[] = [];
    const sharedPaths = new Set<string>();
    const changeTypeByPath = new Map(changedFiles.map((c) => [c.path, c.changeType]));
    for (const changed of [...changedPaths].sort()) {
      if ((ownersByPath.get(changed) ?? []).length > 0) continue; // owned → normal impact
      const dependentFeatures = new Set<string>();
      for (const dependent of dependents.get(changed) ?? []) {
        for (const fid of ownersByPath.get(dependent) ?? []) dependentFeatures.add(fid);
      }
      if (dependentFeatures.size < SHARED_INFRA_FAN_IN) continue;
      sharedPaths.add(changed);
      sharedInfrastructure.push({
        path: changed,
        changeType: changeTypeByPath.get(changed) ?? 'modified',
        dependentFeatureCount: dependentFeatures.size,
        reason: `depended on by ${dependentFeatures.size} features (fan-in ≥ ${SHARED_INFRA_FAN_IN}) and owned by none`,
      });
    }

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
      if (sharedPaths.has(changed)) continue;
      const symbolNote = changedSymbolNote(changed);
      // Hop 1 — direct membership.
      for (const [featureId, entries] of membership) {
        for (const entry of entries) {
          if (entry.path !== changed) continue;
          const confidence = Math.min(entry.confidence, DIRECT_CONFIDENCE);
          bump(
            featureId,
            confidence,
            `${entry.path} belongs to this feature (${entry.confidence})${symbolNote ?? ''}`,
          );
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

    // Rank and surface; below-threshold evidence stays visible as
    // explicit uncertainty instead of vanishing (ADR-0004 §3).
    const SEVERITY_RANK: Record<ImpactSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const suppressedUncertainty: SuppressedUncertainty[] = [...scores.entries()]
      .filter(([, s]) => !isSurfaceable(s.confidence))
      .map(([featureId, s]) => ({
        featureId,
        featureName: features.get(featureId)?.name,
        confidence: s.confidence,
        reason: [...s.reasons][0] ?? '',
      }))
      .sort((a, b) => b.confidence - a.confidence);

    const affectedFeatures: AffectedFeature[] = [...scores.entries()]
      .filter(([, s]) => isSurfaceable(s.confidence))
      .sort((a, b) => {
        const sa = severityOf(a[1].reasons);
        const sb = severityOf(b[1].reasons);
        return SEVERITY_RANK[sa] - SEVERITY_RANK[sb] || b[1].confidence - a[1].confidence;
      })
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
            severity: severityOf(s.reasons),
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
      sharedInfrastructure,
      suppressedUncertainty,
      potentiallyStaleDocuments: [...staleDocs.entries()].map(([path, reason]) => ({ path, reason })),
      currentBranch: stats.currentBranch,
      baseBranch: config?.scan.baseBranch,
    };
  } finally {
    sqlite.close();
  }
}

/** Symbol line spans from the latest scan (file path joined in). */
function loadSymbolSpans(db: FeatureMapDatabase): SymbolSpan[] {
  return db
    .select({
      id: schema.symbols.id,
      name: schema.symbols.name,
      kind: schema.symbols.kind,
      startLine: schema.symbols.startLine,
      endLine: schema.symbols.endLine,
      path: schema.files.path,
    })
    .from(schema.symbols)
    .innerJoin(schema.files, eq(schema.symbols.fileId, schema.files.id))
    .all()
    .filter((r) => r.startLine !== null && r.endLine !== null)
    .map((r) => ({
      symbolId: r.id,
      name: r.name,
      kind: r.kind,
      path: r.path,
      startLine: r.startLine as number,
      endLine: r.endLine as number,
    }));
}
