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

describe('live impact RPC (v0.6.3)', () => {
  let repo: string;
  let impactService: ReturnType<typeof createIdeService>;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    // A real temp git repo (copy of fixture 01) so working-tree changes exist.
    repo = mkdtempSync(join(tmpdir(), 'featuremap-ide-impact-'));
    tempDirs.push(repo);
    const { cpSync, writeFileSync } = await import('node:fs');
    const { execFileSync } = await import('node:child_process');
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login');
    cpSync(fixture, repo, { recursive: true, filter: (src) => !src.includes('.featuremap') });
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { stdio: 'ignore' });
    };
    git('init', '-b', 'main', '-q');
    git('add', '.');
    git('commit', '-m', 'feat: init', '--quiet');
    writeFileSync(join(repo, 'src/auth/login.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
    impactService = createIdeService({ repoRoot: repo, dbPath: join(repo, '.featuremap', 'test.db') });
  });

  afterAll(() => {
    impactService.close();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('impact.current is unavailable before the first refresh', () => {
    const current = impactService.handlers['impact.current']() as { available: boolean };
    expect(current.available).toBe(false);
  });

  it('impact.refresh returns a save snapshot with affected features', async () => {
    const result = (await impactService.handlers['impact.refresh']({
      savedFiles: ['src/auth/login.ts'],
      trigger: 'save',
    })) as { snapshot: { generation: number; trigger: { type: string }; summary: { affectedFeatureCount: number }; affectedFeatures: Array<{ featureId: string; severity: string }> } };
    expect(result.snapshot.generation).toBe(1);
    expect(result.snapshot.trigger.type).toBe('save');
    expect(result.snapshot.summary.affectedFeatureCount).toBe(result.snapshot.affectedFeatures.length);
    expect(result.snapshot.affectedFeatures.length).toBeGreaterThan(0);
  });

  it('impact.current serves the cached snapshot and increments generation', async () => {
    const first = impactService.handlers['impact.current']() as { available: boolean; snapshot?: { generation: number } };
    expect(first.available).toBe(true);
    await impactService.handlers['impact.refresh']({ trigger: 'manual' });
    const second = impactService.handlers['impact.current']() as { available: boolean; snapshot?: { generation: number } };
    expect(second.snapshot?.generation).toBe((first.snapshot?.generation ?? 0) + 1);
  });

  it('rejects refresh on an uninitialized repository', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'featuremap-ide-noinit-'));
    try {
      const bad = createIdeService({ repoRoot: empty });
      await expect(bad.handlers['impact.refresh']({ trigger: 'manual' })).rejects.toThrow(/PROJECT_NOT_INITIALIZED/);
      bad.close();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('review & diagnostics RPC (v0.6.4)', () => {
  let rdDir: string;
  let rdDb: string;
  let rdService: ReturnType<typeof createIdeService>;

  beforeAll(async () => {
    rdDir = mkdtempSync(join(tmpdir(), 'featuremap-ide-rd-'));
    rdDb = join(rdDir, 'featuremap.db');
    await runScan(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login'), { dbPath: rdDb });
    rdService = createIdeService({ repoRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login'), dbPath: rdDb });
  });

  afterAll(() => {
    rdService.close();
    rmSync(rdDir, { recursive: true, force: true });
  });

  it('suggestions.list returns an ordered review inbox', () => {
    const rows = rdService.handlers['suggestions.list']({}) as Array<{
      feature: { id: string };
      target: { type: string; id: string; label: string };
      status: string;
      score: number;
    }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.every((r) => r.status === 'suggested')).toBe(true);
    // Deterministic ordering: score DESC.
    const scores = rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('review.explain returns the stored evidence chain', () => {
    const r = rdService.handlers['review.explain']({
      featureId: 'feature:login',
      target: { type: 'symbol', id: 'symbol:src/auth/login-handler.ts:loginHandler' },
    }) as { feature: { id: string }; relation: string; evidenceChain: unknown[] };
    expect(r.feature.id).toBe('feature:login');
    expect(r.relation).toBe('OWNS');
    expect(Array.isArray(r.evidenceChain)).toBe(true);
  });

  it('review.verdict never applies to a non-suggested (declared) relation', () => {
    const r = rdService.handlers['review.verdict']({
      featureId: 'feature:login',
      target: { type: 'symbol', id: 'symbol:src/auth/login-handler.ts:loginHandler' },
      verdict: 'accepted',
    }) as { applied: boolean; reason?: string };
    expect(r.applied).toBe(false);
    if (!r.applied) expect(r.reason).toBe('candidate_changed');
  });

  it('diagnostics.drift returns a DriftReport without scanning', async () => {
    const r = (await rdService.handlers['diagnostics.drift']()) as {
      issues: unknown[];
      summary: { issueCount: number; byType: { relation_broken: number; new_candidate: number } };
    };
    expect(r.summary.issueCount).toBe(r.issues.length);
    expect(typeof r.summary.byType.relation_broken).toBe('number');
    expect(typeof r.summary.byType.new_candidate).toBe('number');
  });

  it('review.verdict invalidates drift (accept removes the suggestion)', async () => {
    const suggestions = rdService.handlers['suggestions.list']({}) as Array<{ feature: { id: string }; target: { type: string; id: string }; fingerprint: string }>;
    const first = suggestions[0];
    // Only run the mutation when a suggested relation exists in the fixture.
    if (first) {
      const verdict = rdService.handlers['review.verdict']({
        featureId: first.feature.id,
        target: { type: first.target.type, id: first.target.id },
        verdict: 'rejected',
        expectedFingerprint: first.fingerprint,
      }) as { applied: boolean };
      expect(verdict.applied).toBe(true);
      // Rejected suggestion is gone from the inbox.
      const after = rdService.handlers['suggestions.list']({}) as Array<{ feature: { id: string }; target: { type: string; id: string } }>;
      expect(after.some((s) => s.feature.id === first.feature.id && s.target.id === first.target.id)).toBe(false);
      // Drift is still computable after invalidation.
      const drift = (await rdService.handlers['diagnostics.drift']()) as { issues: unknown[] };
      expect(Array.isArray(drift.issues)).toBe(true);
    } else {
      expect(suggestions).toHaveLength(0);
    }
  });
});

describe('context.build RPC (v0.6.5)', () => {
  let ctxDir: string;
  let ctxDb: string;
  let ctxService: ReturnType<typeof createIdeService>;
  const repoFixture = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login');

  beforeAll(async () => {
    ctxDir = mkdtempSync(join(tmpdir(), 'featuremap-ide-ctx-'));
    ctxDb = join(ctxDir, 'featuremap.db');
    await runScan(repoFixture, { dbPath: ctxDb });
    ctxService = createIdeService({ repoRoot: repoFixture, dbPath: ctxDb });
  });

  afterAll(() => {
    ctxService.close();
    rmSync(ctxDir, { recursive: true, force: true });
  });

  it('returns a canonical document with sections, recommended files and artifact', () => {
    const doc = ctxService.handlers['context.build']({ featureId: 'feature:login' }) as {
      contextId: string;
      feature: { name: string };
      sections: { core: unknown[] };
      recommendedFiles: unknown[];
      markdown: string;
      artifact: { relativePath: string };
    };
    expect(doc.feature.name).toBe('Login');
    expect(doc.contextId).toBe('login');
    expect(doc.artifact.relativePath).toBe('.featuremap/context/login.md');
    expect(doc.sections.core.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.recommendedFiles)).toBe(true);
    expect(doc.markdown).toContain('# Feature Context: Login');
    expect(doc.markdown).toContain('## Recommended Files');
  });

  it('is task-aware (task section appears) and read-only over the DB', async () => {
    const { openDatabase, schema } = await import('@featuremap/db');
    const count = (): number => {
      const { db, sqlite } = openDatabase(ctxDb);
      try {
        return db.select().from(schema.evidence).all().length;
      } finally {
        sqlite.close();
      }
    };
    const before = count();
    const doc = ctxService.handlers['context.build']({ featureId: 'feature:login', task: '  Add refresh token rotation  ' }) as {
      task?: string;
      markdown: string;
      contextId: string;
    };
    expect(doc.task).toBe('Add refresh token rotation');
    expect(doc.markdown).toContain('## Task');
    expect(doc.contextId).not.toBe('login');
    expect(count()).toBe(before);
  });

  it('rejects an unknown feature as CONTEXT_BUILD_FAILED', () => {
    expect(() => ctxService.handlers['context.build']({ featureId: 'feature:nope' })).toThrow(/CONTEXT_BUILD_FAILED|FEATURE_NOT_FOUND/);
  });

  it('rejects a missing featureId', () => {
    expect(() => ctxService.handlers['context.build']({})).toThrow(/featureId is required/);
  });
});
