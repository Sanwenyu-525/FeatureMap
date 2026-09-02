/**
 * Code Intelligence domain tests (v0.6.2 plan §11).
 *
 * Symbol resolution, candidate filtering (accepted / suggested /
 * rejected / no-evidence), deterministic ranking, Hover payloads,
 * document CodeLens batching and explain reuse.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openMemoryDatabase, schema } from '@featuremap/db';
import { runScan } from '../src/scan-runner.js';
import {
  CODE_INTELLIGENCE_POLICY,
  SymbolFeatureIndex,
  explainFeatureRelation,
  getCodeIntelligence,
  getDocumentIntelligence,
} from '../src/code-intelligence/index.js';
import type { RelatedFeature, SymbolRef } from '../src/code-intelligence/types.js';

/** Seed an in-memory store with a controlled symbol/candidate scenario. */
function seedScenario(): ReturnType<typeof openMemoryDatabase> {
  const { db, sqlite } = openMemoryDatabase();
  db.insert(schema.projects).values({ id: 'p', name: 't', root: '/tmp/t' }).run();
  db.insert(schema.files).values({ id: 'f', projectId: 'p', path: 'src/app.ts' }).run();
  db.insert(schema.symbols)
    .values([
      { id: 'symbol:src/app.ts:UserService', fileId: 'f', name: 'UserService', kind: 'class', startLine: 1, endLine: 20 },
      { id: 'symbol:src/app.ts:createUser', fileId: 'f', name: 'createUser', kind: 'method', startLine: 2, endLine: 6 },
    ])
    .run();

  const features = [
    { id: 'feature:a', name: 'A' },
    { id: 'feature:b', name: 'B' },
    { id: 'feature:c', name: 'C' },
    { id: 'feature:d', name: 'D' },
    { id: 'feature:e', name: 'E' },
    { id: 'feature:f', name: 'F' },
    { id: 'feature:g', name: 'G' },
  ];
  db.insert(schema.features).values(features.map((f) => ({ ...f, pattern: 'Generic', confidence: 0.9 }))).run();

  const target = 'src/app.ts:UserService';
  // Order deliberately shuffled to pin deterministic output (plan §11.3).
  const candidates = [
    { featureId: 'feature:c', targetId: target, targetType: 'symbol' as const, relation: 'owns' as const, status: 'suggested' as const, score: 0.6, evidenceChain: [{ relationType: 'CONTAINS', sourceId: 'src/app.ts', targetId: 'symbol:src/app.ts:UserService', confidence: 1 }] },
    { featureId: 'feature:a', targetId: target, targetType: 'symbol' as const, relation: 'owns' as const, status: 'accepted' as const, score: 0.9, evidenceChain: [{ relationType: 'CONTAINS', sourceId: 'src/app.ts', targetId: 'symbol:src/app.ts:UserService', confidence: 1 }] },
    { featureId: 'feature:d', targetId: target, targetType: 'symbol' as const, relation: 'owns' as const, status: 'rejected' as const, score: 0.99, evidenceChain: [] },
    { featureId: 'feature:b', targetId: target, targetType: 'symbol' as const, relation: 'owns' as const, status: 'suggested' as const, score: 0.95, evidenceChain: [{ relationType: 'CONTAINS', sourceId: 'src/app.ts', targetId: 'symbol:src/app.ts:UserService', confidence: 1 }] },
    { featureId: 'feature:e', targetId: target, targetType: 'symbol' as const, relation: 'owns' as const, status: 'suggested' as const, score: 0.95, evidenceChain: [] },
    { featureId: 'feature:f', targetId: target, targetType: 'symbol' as const, relation: 'DEPENDS_ON' as const, status: 'declared' as const, score: 1, evidenceChain: [{ relationType: 'IMPORTS', sourceId: 'src/app.ts', targetId: 'src/x.ts', confidence: 1 }] },
  ];
  db.insert(schema.featureCandidates)
    .values(candidates.map((c) => ({ id: `c_${c.featureId}`, featureId: c.featureId, targetType: c.targetType, targetId: c.targetId, relation: c.relation, status: c.status, score: c.score, distance: 1, fanIn: 1, evidenceChain: c.evidenceChain })))
    .run();

  // Confirmed OWNS via feature_assets (asset type symbol).
  db.insert(schema.assets).values([
    { id: 'a_sym', type: 'symbol', path: 'src/app.ts', name: 'UserService', metadata: { kind: 'class' } },
  ]).run();
  db.insert(schema.featureAssets).values([{ featureId: 'feature:g', assetId: 'a_sym', confidence: 1 }]).run();

  return { db, sqlite };
}

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login');

describe('SymbolFeatureIndex.resolveSymbol', () => {
  it('matches name + line against the same-named symbol', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      const ref: SymbolRef = { filePath: 'src/app.ts', name: 'UserService', startLine: 5 };
      // Only the class is named UserService; the method is a different symbol.
      expect(index.resolveSymbol(ref)?.id).toBe('symbol:src/app.ts:UserService');
    } finally {
      sqlite.close();
    }
  });

  it('matches by name without a line', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      expect(index.resolveSymbol({ filePath: 'src/app.ts', name: 'UserService' })?.id).toBe('symbol:src/app.ts:UserService');
    } finally {
      sqlite.close();
    }
  });

  it('matches by line only (fallback path)', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      expect(index.resolveSymbol({ filePath: 'src/app.ts', startLine: 3 })?.id).toBe('symbol:src/app.ts:createUser');
    } finally {
      sqlite.close();
    }
  });

  it('returns null when nothing matches', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      expect(index.resolveSymbol({ filePath: 'src/app.ts', startLine: 99 })).toBeNull();
      expect(index.resolveSymbol({ filePath: 'src/missing.ts', name: 'x' })).toBeNull();
    } finally {
      sqlite.close();
    }
  });
});

describe('SymbolFeatureIndex.relatedFeaturesForSymbol (plan §11.2/§11.4)', () => {
  it('filters statuses and ranks deterministically', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      const symbolId = 'symbol:src/app.ts:UserService';
      const features = index.relatedFeaturesForSymbol(symbolId, { limit: 10 });

      // Confirmed OWNS (asset) first, then accepted, declared, high-conf suggested.
      const ids = features.map((f) => f.featureId);
      expect(ids).toEqual(['feature:g', 'feature:a', 'feature:f', 'feature:b']);
      // Rejected (D) and no-evidence (E) and low-confidence (C) are absent.
      expect(ids).not.toContain('feature:d');
      expect(ids).not.toContain('feature:e');
      expect(ids).not.toContain('feature:c');
      // Every returned relation carries evidence metadata.
      for (const f of features) expect(f.evidence.available).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('excludes suggested entirely when includeSuggested is false', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      const ids = index.relatedFeaturesForSymbol('symbol:src/app.ts:UserService', { includeSuggested: false, limit: 10 }).map((f) => f.featureId);
      expect(ids).toEqual(['feature:g', 'feature:a', 'feature:f']);
    } finally {
      sqlite.close();
    }
  });

  it('keeps output deterministic across repeated queries', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      const first = index.relatedFeaturesForSymbol('symbol:src/app.ts:UserService', { limit: 10 }).map((f) => f.featureId);
      const second = index.relatedFeaturesForSymbol('symbol:src/app.ts:UserService', { limit: 10 }).map((f) => f.featureId);
      expect(first).toEqual(second);
    } finally {
      sqlite.close();
    }
  });

  it('honours the limit', () => {
    const { db, sqlite } = seedScenario();
    try {
      const index = SymbolFeatureIndex.load(db);
      expect(index.relatedFeaturesForSymbol('symbol:src/app.ts:UserService', { limit: 2 })).toHaveLength(2);
    } finally {
      sqlite.close();
    }
  });
});

describe('fixture 01 integration', () => {
  let tempDir: string;
  let dbPath: string;
  let index: SymbolFeatureIndex;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'fm-ci-'));
    dbPath = join(tempDir, 'featuremap.db');
    await runScan(fixtureRoot, { dbPath });
    index = SymbolFeatureIndex.build(fixtureRoot, dbPath);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves a real stored symbol and returns its feature', () => {
    const ref: SymbolRef = { filePath: 'src/auth/login-handler.ts', name: 'loginHandler', startLine: 3 };
    const resolved = index.resolveSymbol(ref);
    expect(resolved?.id).toBe('symbol:src/auth/login-handler.ts:loginHandler');
    const features = index.relatedFeaturesForSymbol(resolved!.id, { limit: 10 }) as RelatedFeature[];
    const login = features.find((f) => f.featureId === 'feature:login');
    expect(login?.relation.type).toBe('OWNS');
    expect(login?.relation.status).toBe('declared');
    expect(login?.evidence.available).toBe(true);
  });

  it('getCodeIntelligence returns a compact hover payload', () => {
    const result = getCodeIntelligence(fixtureRoot, { filePath: 'src/auth/login-handler.ts', name: 'loginHandler', startLine: 3 }, { index, dbPath });
    expect(result?.symbol.name).toBe('loginHandler');
    expect(result?.primaryFeature?.id).toBe('feature:login');
    expect(Array.isArray(result?.directDependencies)).toBe(true);
    expect(Array.isArray(result?.tests)).toBe(true);
  });

  it('getDocumentIntelligence batches symbols for a document', () => {
    const rows = getDocumentIntelligence('src/auth/login-handler.ts', { index });
    expect(rows.length).toBeGreaterThan(0);
    const login = rows.find((r) => r.symbol.name === 'loginHandler');
    expect(login?.feature.id).toBe('feature:login');
    expect(login?.relation).toBe('OWNS');
  });

  it('explainFeatureRelation reuses the stored evidence chain', () => {
    const exp = explainFeatureRelation(fixtureRoot, 'feature:login', 'symbol:src/auth/login-handler.ts:loginHandler', dbPath);
    expect(exp.status).toBe('declared');
    expect(exp.relation).toBe('owns');
    expect(Array.isArray(exp.chain)).toBe(true);
  });

  it('confidence policy is centralized', () => {
    expect(CODE_INTELLIGENCE_POLICY.codeLensMinConfidence).toBeGreaterThanOrEqual(CODE_INTELLIGENCE_POLICY.hoverMinConfidence);
  });
});
