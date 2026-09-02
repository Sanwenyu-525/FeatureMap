/**
 * IDE service handlers against the react-express-basic fixture and an
 * empty temp repo (ADR-0008 §3: the service is the same analysis path
 * as CLI / API / MCP, exercised here directly).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '@featuremap/pipeline';
import { createIdeService, type FeatureDetail, type ProjectStatus } from '../src/index.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

let tempDir: string;
let dbPath: string;
let service: ReturnType<typeof createIdeService>;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'featuremap-ide-'));
  dbPath = join(tempDir, 'featuremap.db');
  await runScan(fixtureRoot, { dbPath });
  service = createIdeService({ repoRoot: fixtureRoot, dbPath });
});

afterAll(() => {
  service.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('project.status', () => {
  it('reports an initialized, scanned project with counts', () => {
    const status = service.handlers['project.status'](undefined) as ProjectStatus;
    expect(status.initialized).toBe(true);
    expect(status.scanned).toBe(true);
    expect(status.root).toBe(fixtureRoot);
    expect(status.featureCount).toBeGreaterThanOrEqual(2);
    expect(status.technologies.length).toBeGreaterThan(0);
  });

  it('does not claim initialized when featuremap.yaml is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'featuremap-ide-empty-'));
    try {
      const s = createIdeService({ repoRoot: empty, dbPath: join(empty, '.featuremap', 't.db') });
      const status = s.handlers['project.status'](undefined) as ProjectStatus;
      expect(status.initialized).toBe(false);
      expect(status.scanned).toBe(false);
      expect(status.featureCount).toBe(0);
      s.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('features.list', () => {
  it('lists discovered features', () => {
    const features = service.handlers['features.list'](undefined) as Array<{ id: string; pattern: string }>;
    const ids = features.map((f) => f.id);
    expect(ids).toContain('feature:login');
    expect(ids).toContain('feature:users');
  });

  it('throws PROJECT_NOT_INITIALIZED without a config', () => {
    const empty = mkdtempSync(join(tmpdir(), 'featuremap-ide-nocfg-'));
    try {
      const s = createIdeService({ repoRoot: empty });
      expect(() => s.handlers['features.list'](undefined)).toThrow(/PROJECT_NOT_INITIALIZED/);
      s.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('features.get', () => {
  it('returns detail with assets, documents and candidates', () => {
    const detail = service.handlers['features.get']({ featureId: 'feature:login' }) as FeatureDetail;
    expect(detail.id).toBe('feature:login');
    expect(detail.assets.length).toBeGreaterThan(0);
    expect(Array.isArray(detail.documents)).toBe(true);
    expect(Array.isArray(detail.candidates)).toBe(true);
  });

  it('throws FEATURE_NOT_FOUND for an unknown id', () => {
    expect(() => service.handlers['features.get']({ featureId: 'nope' })).toThrow(/FEATURE_NOT_FOUND/);
  });
});

describe('init.run / scan.run on a fresh repository', () => {
  it('initializes, then scans incrementally', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'featuremap-ide-init-'));
    try {
      const s = createIdeService({ repoRoot: repo, dbPath: join(repo, '.featuremap', 'test.db') });
      const init = s.handlers['init.run'](undefined) as { created: boolean; configPath: string };
      expect(init.created).toBe(true);
      expect(existsSync(init.configPath)).toBe(true);
      expect(existsSync(join(repo, '.featuremap'))).toBe(true);

      // Idempotent: a second init does not overwrite.
      expect((s.handlers['init.run'](undefined) as { created: boolean }).created).toBe(false);

      const status = s.handlers['project.status'](undefined) as ProjectStatus;
      expect(status.initialized).toBe(true);

      const scan = (await s.handlers['scan.run']({ mode: 'incremental' })) as { status: string; counts: Record<string, number> };
      expect(scan.status).toBe('completed');
      expect(scan.counts.features).toBeGreaterThanOrEqual(0);
      s.close();
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('rejects an invalid scan mode', async () => {
    await expect(service.handlers['scan.run']({ mode: 'bogus' })).rejects.toThrow();
  });
});

describe('features.list query filter (v0.6.1)', () => {
  it('filters by name / description / pattern', () => {
    const all = service.handlers['features.list'](undefined) as Array<{ id: string }>;
    const ids = all.map((f) => f.id);
    const matched = service.handlers['features.list']({ query: 'login' }) as Array<{ id: string }>;
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.every((f) => f.id === 'feature:login' || f.id.includes('login'))).toBe(true);
    // A nonsense query returns nothing rather than erroring.
    expect(service.handlers['features.list']({ query: 'zzz-no-such-feature' })).toEqual([]);
    // An empty query behaves like no query.
    expect((service.handlers['features.list']({ query: '  ' }) as unknown[]).length).toBe(ids.length);
  });
});

describe('features.get symbol navigation (v0.6.1)', () => {
  let symbolDir: string;
  let symbolDb: string;
  let symbolService: ReturnType<typeof createIdeService>;

  beforeAll(async () => {
    symbolDir = mkdtempSync(join(tmpdir(), 'featuremap-ide-sym-'));
    symbolDb = join(symbolDir, 'featuremap.db');
    // 01-simple-login has a declared symbol candidate (loginHandler).
    const loginFixture = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login');
    await runScan(loginFixture, { dbPath: symbolDb });
    symbolService = createIdeService({ repoRoot: loginFixture, dbPath: symbolDb });
  });

  afterAll(() => {
    symbolService.close();
    rmSync(symbolDir, { recursive: true, force: true });
  });

  it('exposes confirmed symbol assets with a source location', () => {
    const detail = symbolService.handlers['features.get']({ featureId: 'feature:login' }) as FeatureDetail;
    const symbolAssets = detail.assets.filter((a) => a.type === 'symbol');
    expect(symbolAssets.length).toBeGreaterThan(0);
    const withLocation = symbolAssets.filter((a) => a.location !== undefined);
    expect(withLocation.length).toBeGreaterThan(0);
    for (const asset of withLocation) {
      expect(asset.path).toBeTruthy();
      expect(asset.name).toBeTruthy();
      expect(asset.location!.startLine).toBeGreaterThan(0);
    }
  });
});

describe('code intelligence RPC (v0.6.2)', () => {
  let ciDir: string;
  let ciDb: string;
  let ciService: ReturnType<typeof createIdeService>;

  const loginSymbol = (): { filePath: string; name: string; startLine: number } => ({
    filePath: 'src/auth/login-handler.ts',
    name: 'loginHandler',
    startLine: 3,
  });

  beforeAll(async () => {
    ciDir = mkdtempSync(join(tmpdir(), 'featuremap-ide-ci-'));
    ciDb = join(ciDir, 'featuremap.db');
    await runScan(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login'), { dbPath: ciDb });
    ciService = createIdeService({ repoRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login'), dbPath: ciDb });
  });

  afterAll(() => {
    ciService.close();
    rmSync(ciDir, { recursive: true, force: true });
  });

  it('symbols.resolve maps an editor hint to a stored symbol', () => {
    const r = ciService.handlers['symbols.resolve']({ symbol: loginSymbol() }) as { id: string; name: string };
    expect(r.id).toBe('symbol:src/auth/login-handler.ts:loginHandler');
    expect(r.name).toBe('loginHandler');
  });

  it('code.relatedFeatures returns the owning feature with relation type', () => {
    const r = ciService.handlers['code.relatedFeatures']({ symbol: loginSymbol() }) as {
      symbol: { id: string };
      features: Array<{ featureId: string; relation: { type: string; status: string }; evidence: { available: boolean } }>;
    };
    expect(r.symbol.id).toBe('symbol:src/auth/login-handler.ts:loginHandler');
    const login = r.features.find((f) => f.featureId === 'feature:login');
    expect(login?.relation.type).toBe('OWNS');
    expect(login?.relation.status).toBe('declared');
    expect(login?.evidence.available).toBe(true);
  });

  it('code.intelligence returns a compact hover payload', () => {
    const r = ciService.handlers['code.intelligence']({ symbol: loginSymbol() }) as {
      symbol: { name: string };
      primaryFeature?: { id: string };
      directDependencies: unknown[];
      tests: unknown[];
    };
    expect(r.symbol.name).toBe('loginHandler');
    expect(r.primaryFeature?.id).toBe('feature:login');
    expect(Array.isArray(r.directDependencies)).toBe(true);
    expect(Array.isArray(r.tests)).toBe(true);
  });

  it('code.documentIntelligence batches symbols in one call', () => {
    const rows = ciService.handlers['code.documentIntelligence']({ filePath: 'src/auth/login-handler.ts' }) as Array<{
      symbol: { name: string };
      feature: { id: string };
      relation: string;
    }>;
    const login = rows.find((r) => r.symbol.name === 'loginHandler');
    expect(login?.feature.id).toBe('feature:login');
    expect(login?.relation).toBe('OWNS');
  });

  it('code.explainRelation reuses the stored evidence chain', () => {
    const r = ciService.handlers['code.explainRelation']({
      featureId: 'feature:login',
      target: { id: 'symbol:src/auth/login-handler.ts:loginHandler' },
    }) as { status: string; relation: string; chain: unknown[] };
    expect(r.status).toBe('declared');
    expect(r.relation).toBe('owns');
    expect(Array.isArray(r.chain)).toBe(true);
  });

  it('rejects malformed params with an RpcError', () => {
    expect(() => ciService.handlers['symbols.resolve']({})).toThrow(/filePath is required/);
    expect(() => ciService.handlers['code.relatedFeatures']({ symbol: { name: 'x' } })).toThrow(/filePath is required/);
    expect(() => ciService.handlers['code.documentIntelligence']({})).toThrow(/filePath is required/);
    expect(() => ciService.handlers['code.explainRelation']({ featureId: 'feature:login' })).toThrow(/target/);
  });

  it('scan.run invalidates the index; queries still succeed afterwards', async () => {
    const before = ciService.handlers['symbols.resolve']({ symbol: loginSymbol() }) as { id: string } | null;
    expect(before).not.toBeNull();
    const scan = (await ciService.handlers['scan.run']({ mode: 'incremental' })) as { status: string };
    expect(scan.status).toBe('completed');
    const after = ciService.handlers['symbols.resolve']({ symbol: loginSymbol() }) as { id: string } | null;
    expect(after?.id).toBe('symbol:src/auth/login-handler.ts:loginHandler');
  });
});
