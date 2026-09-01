/**
 * ContextResolver — reads every raw fact the Context Builder needs from
 * the Feature Knowledge Graph (SQLite store) and nothing else.
 *
 * This is a **read-only projection**: no row is ever written here, so
 * the graph stays the single source of truth and FeatureContext can
 * never drift away from it (AGENTS.md §15). All returned facts keep
 * enough provenance (analyzerId, confidence, relation ids) for the
 * ranker and renderers to answer "why?".
 *
 * ID conventions (consistent with the rest of the repo):
 * - asset ids are opaque (`a_<sha>`); asset.path is the join key
 * - evidence file ids are plain repo-relative paths
 * - evidence symbol ids are `symbol:<path>:<name>`
 * - candidates store *bare* ids: file → `<path>`, symbol → `<path>:<name>`
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema, type FeatureMapDatabase } from '@featuremap/db';
import { isSurfaceable } from '@featuremap/core';
import type { ContextEvidence, PolicyEntry } from './types.js';

export class FeatureContextError extends Error {
  constructor(
    public readonly code: 'FEATURE_NOT_FOUND' | 'NO_SCAN' | 'EMPTY_GRAPH',
    message: string,
  ) {
    super(message);
  }
}

export interface SymbolInfo {
  name: string;
  kind: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface FeatureFacts {
  feature: {
    id: string;
    name: string;
    description?: string;
    pattern: string;
    status: string;
    confidence: number;
    health?: Record<string, string>;
  };
  /** feature_assets joined with assets (every asset this feature owns). */
  featureAssets: Array<{
    assetId: string;
    type: string;
    path?: string;
    name?: string;
    confidence: number;
  }>;
  /** Non-rejected feature_candidates (the ranked mapping projection). */
  candidates: Array<{
    id: string;
    targetType: 'file' | 'symbol';
    targetId: string;
    relation: 'owns' | 'DEPENDS_ON';
    status: 'declared' | 'suggested' | 'accepted';
    score: number;
    distance: number;
    fanIn: number;
    isAnchor: boolean;
    evidenceChain: Array<{ relationType: string; sourceId: string; targetId: string; confidence: number }>;
  }>;
  /** Files that import this feature's owned files (reverse impact). */
  dependents: Array<{
    file: string;
    ownedTarget: string;
    edgeConfidence: number;
    analyzerId: string;
  }>;
  /** Scoped repository instructions (feature_instructions → instructions → documents). */
  policies: Array<PolicyEntry & { documentId: string }>;
  /** BELONGS_TO_FEATURE evidence pointing at this feature. */
  evidence: Array<ContextEvidence>;
  /** Bare symbol id (`path:name`) → symbol details. */
  symbols: Map<string, SymbolInfo>;
  /** Whole-repository file in-degree over IMPORTS (fan-in for shared-infra penalty). */
  fileFanIn: Map<string, number>;
  /** Symbol-level in-degree over CALLS (whole repository). */
  symbolFanIn: Map<string, number>;
  /** Recent commits touching this feature's owned paths (derived at query time). */
  recentCommits: Array<{
    sha: string;
    author: string;
    committedAt?: string;
    message?: string;
    kind: string;
    changedPaths: string[];
  }>;
}

/** Known conventional-commit prefixes (same set as pipeline/timeline.ts). */
const KNOWN_KINDS = new Set([
  'feat', 'fix', 'docs', 'refactor', 'chore', 'test', 'perf', 'build', 'ci', 'style', 'revert',
]);

export function kindOf(message: string | null | undefined): string {
  const prefix = /^([a-z]+)[:( ]/.exec(message?.trim() ?? '')?.[1]?.toLowerCase() ?? '';
  return KNOWN_KINDS.has(prefix) ? prefix : 'other';
}

function featureLookupWhere(nameOrId: string): SQL {
  if (nameOrId.startsWith('feature:')) {
    return eq(schema.features.id, nameOrId);
  }
  return sql`${schema.features.id} = ${`feature:${slugify(nameOrId)}`} or lower(${schema.features.name}) = lower(${nameOrId})`;
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function bareSymbolId(symbolId: string): string {
  return symbolId.startsWith('symbol:') ? symbolId.slice('symbol:'.length) : symbolId;
}

/**
 * Resolve a feature name/id to a stored feature row (same matching
 * rules as the rest of the CLI: exact id, slug, or case-insensitive name).
 */
export function resolveFeatureRow(
  db: FeatureMapDatabase,
  nameOrId: string,
): FeatureFacts['feature'] {
  const where = featureLookupWhere(nameOrId);
  const row = db.select().from(schema.features).where(where).all()[0];
  if (!row) {
    throw new FeatureContextError(
      'FEATURE_NOT_FOUND',
      `功能"${nameOrId}"不存在。请先运行 "featuremap scan"。`,
    );
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    pattern: row.pattern,
    status: row.status,
    confidence: row.confidence,
    health: (row.health ?? undefined) as Record<string, string> | undefined,
  };
}

/**
 * Collect every raw fact needed for ranking into a FeatureContext.
 *
 * Graceful degradation (AGENTS.md §3.5): an empty or freshly-scanned
 * store still yields a feature row with whatever graph rows exist.
 */
export function resolveFacts(db: FeatureMapDatabase, feature: FeatureFacts['feature']): FeatureFacts {
  // ---- feature_assets -------------------------------------------------
  const featureAssets = db
    .select()
    .from(schema.featureAssets)
    .where(eq(schema.featureAssets.featureId, feature.id))
    .all()
    .flatMap((fa) => {
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
      if (!asset) return [];
      return [
        {
          assetId: asset.id,
          type: asset.type,
          path: asset.path ?? undefined,
          name: asset.name ?? undefined,
          confidence: fa.confidence,
        },
      ];
    });
  const ownedFilePaths = new Set(
    featureAssets.filter((a) => a.type === 'file' && a.path).map((a) => a.path as string),
  );

  // ---- candidates (rejected/superseded never enter a context) ---------
  const candidates = (
    db
      .select()
      .from(schema.featureCandidates)
      .where(
        sql`${schema.featureCandidates.featureId} = ${feature.id} and ${schema.featureCandidates.status} not in ('rejected', 'superseded')`,
      )
      .all() as Array<{
      id: string;
      targetType: 'file' | 'symbol';
      targetId: string;
      relation: 'owns' | 'DEPENDS_ON';
      status: 'declared' | 'suggested' | 'accepted';
      score: number;
      distance: number;
      fanIn: number;
      evidenceChain: Array<{ relationType: string; sourceId: string; targetId: string; confidence: number }>;
    }>
  )
    .filter((c) => isSurfaceable(c.score))
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ ...c, isAnchor: c.status === 'declared' }));

  // ---- reverse dependents (IMPORTS from files outside this feature) ----
  const dependents: FeatureFacts['dependents'] = [];
  for (const ev of db
    .select()
    .from(schema.evidence)
    .where(eq(schema.evidence.relationType, 'IMPORTS'))
    .all()) {
    if (!ownedFilePaths.has(ev.targetId)) continue;
    if (ev.sourceType !== 'file') continue;
    // Own files importing each other are self-dependencies, not external dependents.
    if (ownedFilePaths.has(ev.sourceId)) continue;
    dependents.push({
      file: ev.sourceId,
      ownedTarget: ev.targetId,
      edgeConfidence: ev.confidence,
      analyzerId: ev.analyzerId,
    });
  }
  dependents.sort((a, b) => a.file.localeCompare(b.file));

  // ---- scoped instructions --------------------------------------------
  const policies: FeatureFacts['policies'] = [];
  for (const fi of db
    .select()
    .from(schema.featureInstructions)
    .where(eq(schema.featureInstructions.featureId, feature.id))
    .all()) {
    const instruction = db
      .select()
      .from(schema.instructions)
      .where(eq(schema.instructions.id, fi.instructionId))
      .all()[0];
    if (!instruction) continue;
    const doc = db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, instruction.documentId))
      .all()[0];
    policies.push({
      documentId: instruction.documentId,
      id: instruction.id,
      text: instruction.text,
      level: instruction.level,
      scope: instruction.scope ?? undefined,
      source: doc?.path ?? instruction.documentId,
      documentType: doc?.type ?? 'other',
      estimatedTokens: 0, // filled by the builder
      evidence: [
        {
          analyzerId: instruction.confidence >= 1 ? 'markdown' : 'semantic',
          origin: instruction.confidence >= 1 ? 'deterministic' : 'semantic',
          confidence: instruction.confidence,
          relationType: 'CONSTRAINED_BY',
          sourceId: instruction.documentId,
          targetId: feature.id,
          note: `instruction "${instruction.id}" scoped to this feature`,
        },
      ],
    });
  }

  // ---- BELONGS_TO_FEATURE evidence ------------------------------------
  const evidence: ContextEvidence[] = db
    .select()
    .from(schema.evidence)
    .where(
      sql`${schema.evidence.targetType} = 'feature' and ${schema.evidence.targetId} = ${feature.id}`,
    )
    .all()
    .map((e) => ({
      analyzerId: e.analyzerId,
      origin: e.origin,
      confidence: e.confidence,
      relationType: e.relationType,
      sourceId: e.sourceId,
      targetId: e.targetId,
    }));

  // ---- symbol & file metadata -----------------------------------------
  const symbols = new Map<string, SymbolInfo>();
  for (const sym of db
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
    .all()) {
    symbols.set(bareSymbolId(sym.id), {
      name: sym.name,
      kind: sym.kind,
      path: sym.path,
      startLine: sym.startLine ?? undefined,
      endLine: sym.endLine ?? undefined,
    });
  }

  // ---- fan-in maps (shared-infrastructure penalty) --------------------
  const fileFanIn = new Map<string, number>();
  const symbolFanIn = new Map<string, number>();
  for (const ev of db
    .select()
    .from(schema.evidence)
    .where(inArray(schema.evidence.relationType, ['IMPORTS', 'CALLS']))
    .all()) {
    if (ev.relationType === 'IMPORTS') {
      fileFanIn.set(ev.targetId, (fileFanIn.get(ev.targetId) ?? 0) + 1);
    } else {
      symbolFanIn.set(ev.targetId, (symbolFanIn.get(ev.targetId) ?? 0) + 1);
    }
  }

  // ---- recent commits (derived at query time, same semantics as timeline) --
  const recentCommits = db
    .select()
    .from(schema.commits)
    .all()
    .flatMap((c) => {
      const changedPaths = db
        .select()
        .from(schema.commitFiles)
        .where(eq(schema.commitFiles.commitSha, c.sha))
        .all()
        .map((r) => r.path)
        .filter((p) => ownedFilePaths.has(p));
      if (changedPaths.length === 0) return [];
      return [
        {
          sha: c.sha,
          author: c.author ?? 'unknown',
          committedAt: c.committedAt ?? undefined,
          message: c.message ?? undefined,
          kind: kindOf(c.message),
          changedPaths,
        },
      ];
    })
    .sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''))
    .slice(0, 50);

  return {
    feature,
    featureAssets,
    candidates,
    dependents,
    policies,
    evidence,
    symbols,
    fileFanIn,
    symbolFanIn,
    recentCommits,
  };
}