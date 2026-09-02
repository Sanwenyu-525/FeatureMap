/**
 * Code Intelligence payloads (v0.6.2 plan §4.3 / Phase F).
 *
 * Hover (`getCodeIntelligence`) and document CodeLens
 * (`getDocumentIntelligence`) are the light query paths: they read the
 * in-memory SymbolFeatureIndex and at most a couple of narrow DB
 * queries (CALLS evidence, feature test assets). Full evidence chains
 * are deferred to Explain Relation.
 */
import { and, eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import type { SymbolRef } from './types.js';
import type { SymbolFeatureIndex } from './symbol-feature-index.js';
import { CODE_INTELLIGENCE_POLICY } from './policy.js';

export interface DirectDependency {
  symbolId?: string;
  name: string;
  filePath?: string;
}

export interface TestEntry {
  path: string;
  symbolName?: string;
}

export interface CodeIntelligenceResult {
  symbol: { id: string; name: string; filePath: string };
  primaryFeature?: { id: string; name: string; relation: 'OWNS' | 'DEPENDS_ON'; confidence: number };
  relatedFeatures: Array<{ id: string; name: string; relation: 'OWNS' | 'DEPENDS_ON'; confidence: number }>;
  directDependencies: DirectDependency[];
  tests: TestEntry[];
  /** v0.6.2: left empty; reuses Change Intelligence when a cheap Git source exists. */
  recentChange?: { commit?: string; date?: string; summary?: string };
}

/** `symbol:path:name` → repo-relative path (POSIX paths have no colon). */
function fileOfSymbolId(symbolId: string): string | undefined {
  const body = symbolId.startsWith('symbol:') ? symbolId.slice('symbol:'.length) : symbolId;
  const sep = body.lastIndexOf(':');
  return sep > 0 ? body.slice(0, sep) : undefined;
}

export interface CodeIntelligenceContext {
  index: SymbolFeatureIndex;
  dbPath?: string;
}

/** Hover payload for one editor position (light query, plan §7). */
export function getCodeIntelligence(
  repoRoot: string,
  ref: SymbolRef,
  ctx: CodeIntelligenceContext,
): CodeIntelligenceResult | null {
  const symbol = ctx.index.resolveSymbol(ref);
  if (!symbol) return null;
  const features = ctx.index.relatedFeaturesForSymbol(symbol.id, {
    includeSuggested: true,
    minConfidence: CODE_INTELLIGENCE_POLICY.hoverMinConfidence,
    limit: CODE_INTELLIGENCE_POLICY.maxHoverFeatures + 1,
  });
  const primary = features[0];
  const { db, sqlite } = openDatabase(ctx.dbPath ?? defaultDatabasePath(repoRoot));
  try {
    // Direct dependencies: symbol → CALLS → symbol, distance 1 only.
    const directDependencies = db
      .select()
      .from(schema.evidence)
      .where(
        and(
          eq(schema.evidence.sourceType, 'symbol'),
          eq(schema.evidence.sourceId, symbol.id),
          eq(schema.evidence.relationType, 'CALLS'),
          eq(schema.evidence.targetType, 'symbol'),
        ),
      )
      .all()
      .slice(0, CODE_INTELLIGENCE_POLICY.maxHoverDependencies)
      .map((e) => ({
        symbolId: e.targetId,
        name: e.targetId.slice(e.targetId.lastIndexOf(':') + 1),
        filePath: fileOfSymbolId(e.targetId),
      }));

    // Related tests: the primary feature's test assets (never a fresh scan).
    const tests: TestEntry[] = [];
    if (primary) {
      const faRows = db
        .select()
        .from(schema.featureAssets)
        .where(eq(schema.featureAssets.featureId, primary.featureId))
        .all();
      const assetIds = faRows.map((fa) => fa.assetId);
      if (assetIds.length > 0) {
        const assetRows = db.select().from(schema.assets).all();
        for (const a of assetRows) {
          if (a.type !== 'test' || !assetIds.includes(a.id)) continue;
          if (a.path) tests.push({ path: a.path });
          if (tests.length >= CODE_INTELLIGENCE_POLICY.maxHoverTests) break;
        }
      }
    }

    return {
      symbol: { id: symbol.id, name: symbol.name, filePath: symbol.filePath },
      primaryFeature: primary
        ? { id: primary.featureId, name: primary.name, relation: primary.relation.type, confidence: primary.relation.confidence }
        : undefined,
      relatedFeatures: features.slice(0, CODE_INTELLIGENCE_POLICY.maxHoverFeatures + 1).map((f) => ({
        id: f.featureId,
        name: f.name,
        relation: f.relation.type,
        confidence: f.relation.confidence,
      })),
      directDependencies,
      tests,
    };
  } finally {
    sqlite.close();
  }
}

export interface DocumentSymbolFeature {
  symbol: { id: string; name: string; startLine: number; endLine: number };
  feature: { id: string; name: string };
  relation: 'OWNS' | 'DEPENDS_ON';
  confidence: number;
  status: string;
}

/**
 * Batch document intelligence for CodeLens (plan §8.4): one call per
 * document, server-side eligibility, never N+1.
 */
export function getDocumentIntelligence(filePath: string, ctx: CodeIntelligenceContext): DocumentSymbolFeature[] {
  const out: DocumentSymbolFeature[] = [];
  for (const range of ctx.index.symbolsForFile(filePath)) {
    const rel = ctx.index.relatedFeaturesForSymbol(range.symbolId, {
      includeSuggested: true,
      minConfidence: CODE_INTELLIGENCE_POLICY.codeLensMinConfidence,
      limit: 1,
    })[0];
    if (!rel) continue;
    out.push({
      symbol: { id: range.symbolId, name: range.name, startLine: range.startLine, endLine: range.endLine },
      feature: { id: rel.featureId, name: rel.name },
      relation: rel.relation.type,
      confidence: rel.relation.confidence,
      status: rel.relation.status,
    });
  }
  return out;
}
