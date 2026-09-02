/**
 * SymbolFeatureIndex (v0.6.2 plan §5, Phase C).
 *
 * An in-memory **read model** — never a second source of truth. It
 * accelerates the IDE hot paths (resolve / related-features / document
 * intelligence) by loading `symbols` + `feature_candidates` +
 * `feature_assets` once per repository generation; mutations invalidate
 * the whole repository (lazy rebuild) instead of row-level syncing.
 */
import { eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema, type FeatureMapDatabase } from '@featuremap/db';
import type { FeaturePattern } from '@featuremap/core';
import type {
  FeatureRelationStatus,
  FeatureRelationType,
  RelatedFeature,
  RelatedFeaturesOptions,
  RelatedFeaturesResult,
  ResolvedSymbol,
  SymbolRef,
} from './types.js';
import { CODE_INTELLIGENCE_POLICY } from './policy.js';

export interface IndexedFeatureRelation {
  featureId: string;
  relation: FeatureRelationType;
  status: FeatureRelationStatus;
  confidence: number;
  distance: number;
  fanIn: number;
  evidenceCount: number;
}

export interface IndexedSymbolRange {
  symbolId: string;
  name: string;
  startLine: number;
  endLine: number;
}

interface IndexedSymbol extends IndexedSymbolRange {
  filePath: string;
}

/** Deterministic rank: confirmed OWNS < confirmed DEPENDS_ON < accepted < declared < suggested. */
function rankOf(rel: IndexedFeatureRelation): number {
  if (rel.status === 'confirmed') return rel.relation === 'OWNS' ? 0 : 1;
  if (rel.status === 'accepted') return 2;
  if (rel.status === 'declared') return 3;
  return 4;
}

export class SymbolFeatureIndex {
  private constructor(
    private readonly bySymbolId: Map<string, IndexedFeatureRelation[]>,
    private readonly symbolsByFile: Map<string, IndexedSymbolRange[]>,
    private readonly symbolsById: Map<string, IndexedSymbol>,
    private readonly featuresById: Map<string, { name: string; description?: string; pattern: FeaturePattern }>,
    public readonly generation: number,
  ) {}

  /** Build the index from a store snapshot (lazy; run once per generation). */
  static load(db: FeatureMapDatabase, generation = 1): SymbolFeatureIndex {
    const bySymbolId = new Map<string, IndexedFeatureRelation[]>();
    const symbolsByFile = new Map<string, IndexedSymbolRange[]>();
    const symbolsById = new Map<string, IndexedSymbol>();
    const featuresById = new Map<string, { name: string; description?: string; pattern: FeaturePattern }>();

    for (const f of db.select().from(schema.features).all()) {
      featuresById.set(f.id, {
        name: f.name,
        description: f.description ?? undefined,
        pattern: f.pattern,
      });
    }

    const symbolRows = db
      .select({
        id: schema.symbols.id,
        name: schema.symbols.name,
        kind: schema.symbols.kind,
        startLine: schema.symbols.startLine,
        endLine: schema.symbols.endLine,
        filePath: schema.files.path,
      })
      .from(schema.symbols)
      .innerJoin(schema.files, eq(schema.symbols.fileId, schema.files.id))
      .all();
    for (const s of symbolRows) {
      if (s.startLine === null || s.endLine === null) continue;
      const range: IndexedSymbolRange = { symbolId: s.id, name: s.name, startLine: s.startLine, endLine: s.endLine };
      const fileRanges = symbolsByFile.get(s.filePath) ?? [];
      fileRanges.push(range);
      symbolsByFile.set(s.filePath, fileRanges);
      symbolsById.set(s.id, { ...range, filePath: s.filePath });
    }

    const push = (symbolId: string, rel: IndexedFeatureRelation): void => {
      const existing = bySymbolId.get(symbolId) ?? [];
      existing.push(rel);
      bySymbolId.set(symbolId, existing);
    };

    // feature_candidates: candidate.targetId is `<path>:<name>`; the
    // symbol id is `symbol:<targetId>`.
    for (const c of db.select().from(schema.featureCandidates).where(eq(schema.featureCandidates.targetType, 'symbol')).all()) {
      if (c.status === 'rejected' || c.status === 'superseded') continue;
      const chain = (c.evidenceChain ?? []) as unknown[];
      push(`symbol:${c.targetId}`, {
        featureId: c.featureId,
        relation: c.relation === 'owns' ? 'OWNS' : 'DEPENDS_ON',
        status: c.status === 'declared' || c.status === 'accepted' ? c.status : 'suggested',
        confidence: c.score,
        distance: c.distance,
        fanIn: c.fanIn,
        evidenceCount: chain.length,
      });
    }

    // feature_assets symbol relations are confirmed OWNS. Assets carry
    // path+name (not the symbol id), so map through (path, name).
    const symbolAssets = db.select().from(schema.assets).where(eq(schema.assets.type, 'symbol')).all();
    const assetById = new Map(symbolAssets.map((a) => [a.id, a] as const));
    for (const fa of db.select().from(schema.featureAssets).all()) {
      const asset = assetById.get(fa.assetId);
      if (!asset || asset.path === undefined || asset.name === undefined) continue;
      push(`symbol:${asset.path}:${asset.name}`, {
        featureId: fa.featureId,
        relation: 'OWNS',
        status: 'confirmed',
        confidence: fa.confidence,
        distance: 0,
        fanIn: 0,
        evidenceCount: 1,
      });
    }

    return new SymbolFeatureIndex(bySymbolId, symbolsByFile, symbolsById, featuresById, generation);
  }

  /** Open the repository store and build a fresh index (convenience for CLI/tests). */
  static build(repoRoot: string, dbPathOverride?: string, generation = 1): SymbolFeatureIndex {
    const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
    try {
      return SymbolFeatureIndex.load(db, generation);
    } finally {
      sqlite.close();
    }
  }

  /** Resolve an editor hint to a stored symbol (plan §A2). */
  resolveSymbol(ref: SymbolRef): ResolvedSymbol | null {
    const ranges = this.symbolsByFile.get(ref.filePath) ?? [];
    if (ranges.length === 0) return null;
    const line = ref.startLine;
    let pool = ranges;
    if (ref.name !== undefined && line !== undefined) {
      pool = ranges.filter((r) => r.name === ref.name && r.startLine <= line && line <= r.endLine);
    } else if (line !== undefined) {
      pool = ranges.filter((r) => r.startLine <= line && line <= r.endLine);
    } else if (ref.name !== undefined) {
      pool = ranges.filter((r) => r.name === ref.name);
    }
    if (pool.length === 0) return null;
    // Smallest range wins (most specific semantic node), then line order.
    const best = [...pool].sort((a, b) => {
      const da = a.endLine - a.startLine;
      const db_ = b.endLine - b.startLine;
      return da - db_ || a.startLine - b.startLine;
    })[0];
    if (!best) return null;
    const symbol = this.symbolsById.get(best.symbolId);
    if (!symbol) return null;
    return {
      id: symbol.symbolId,
      name: symbol.name,
      filePath: symbol.filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    };
  }

  /** All symbols declared in a file (for document-level CodeLens). */
  symbolsForFile(filePath: string): IndexedSymbolRange[] {
    return this.symbolsByFile.get(filePath) ?? [];
  }

  /** Eligible related features of one stored symbol, ranked deterministically. */
  relatedFeaturesForSymbol(symbolId: string, options: RelatedFeaturesOptions = {}): RelatedFeature[] {
    const { includeSuggested = true, minConfidence = CODE_INTELLIGENCE_POLICY.relatedFeaturesMinConfidence, limit = CODE_INTELLIGENCE_POLICY.defaultRelatedLimit } = options;
    const rels = (this.bySymbolId.get(symbolId) ?? []).filter((rel) => {
      if (rel.status === 'suggested') {
        if (!includeSuggested) return false;
        // Evidence must exist and confidence must clear the bar (plan §A3, Risk 4).
        if (rel.evidenceCount === 0) return false;
        let required = minConfidence;
        // High fan-in DEPENDS_ON is shared-infrastructure-prone and needs
        // a higher bar (plan §15 — graph metrics, not hardcoded names).
        if (rel.relation === 'DEPENDS_ON' && rel.fanIn >= CODE_INTELLIGENCE_POLICY.highFanInThreshold) {
          required = Math.max(required, CODE_INTELLIGENCE_POLICY.codeLensMinConfidence);
        }
        if (rel.confidence < required) return false;
      }
      return true;
    });

    return rels
      .sort((a, b) => {
        const r = rankOf(a) - rankOf(b);
        if (r !== 0) return r;
        return b.confidence - a.confidence || a.distance - b.distance || a.fanIn - b.fanIn || a.featureId.localeCompare(b.featureId);
      })
      .slice(0, limit)
      .map((rel) => {
        const feature = this.featuresById.get(rel.featureId);
        return {
          featureId: rel.featureId,
          name: feature?.name ?? rel.featureId,
          description: feature?.description,
          pattern: feature?.pattern ?? 'Generic',
          relation: {
            type: rel.relation,
            status: rel.status,
            confidence: rel.confidence,
          },
          evidence: {
            // Human/declared-confirmed relations carry their authority even
            // without a stored chain; suggested relations need evidence
            // (enforced by the filter above, plan §11.4).
            available: rel.evidenceCount > 0 || rel.status !== 'suggested',
            count: rel.evidenceCount,
          },
        };
      });
  }

  /** Resolve a hint and return its related features in one call (plan §4.2). */
  relatedFeatures(ref: SymbolRef, options: RelatedFeaturesOptions = {}): RelatedFeaturesResult | null {
    const symbol = this.resolveSymbol(ref);
    if (!symbol) return null;
    return { symbol, features: this.relatedFeaturesForSymbol(symbol.id, options) };
  }
}
