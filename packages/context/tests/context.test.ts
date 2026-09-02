/**
 * Phase 5 quality tests — Context ranking, token budget, task-aware
 * ranking, JSON schema stability and evidence guarantees across the six
 * fixtures (docs/context/phase5-acceptance-checklist.md §12).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase, type FeatureMapDatabase } from '@featuremap/db';
import { assembleContext } from '../src/context-builder.js';
import { renderJson } from '../src/renderers/json.js';
import { renderMarkdown } from '../src/renderers/markdown.js';
import { renderAgent } from '../src/renderers/agent.js';
import { renderContext } from '../src/context-renderer.js';
import type { FeatureContext } from '../src/types.js';

function stripTimestamp(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripTimestamp);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== 'timestamp')
        .map(([k, v]) => [k, stripTimestamp(v)]),
    );
  }
  return value;
}
import {
  seedProject,
  seedFile,
  seedSymbol,
  seedFeature,
  seedFeatureAsset,
  seedCandidate,
  seedBelongsToEvidence,
  seedImports,
  seedInstruction,
  seedCommit,
} from './seed.js';

let db: FeatureMapDatabase;
let close: () => void;

beforeEach(() => {
  const opened = openMemoryDatabase();
  db = opened.db;
  close = () => opened.sqlite.close();
  seedProject(db);
});

afterEach(() => {
  close();
});

/** Login feature shared by most fixtures. */
function seedLoginFeature(db: FeatureMapDatabase): void {
  seedFeature(db, 'feature:login', 'Login', 'Authentication', '用户登录认证');
  const anchorFile = seedFile(db, 'src/auth/login-handler.ts');
  const serviceFile = seedFile(db, 'src/auth/auth-service.ts');
  const repoFile = seedFile(db, 'src/auth/user-repository.ts');
  seedFile(db, 'src/shared/logger.ts');
  const testFile = seedFile(db, 'src/auth/login.test.ts', { type: 'test' });
  const endpoint = seedFile(db, 'src/api/login.ts', { type: 'endpoint', name: 'login (POST /api/login)' });

  seedFeatureAsset(db, 'feature:login', anchorFile, 1);
  seedFeatureAsset(db, 'feature:login', serviceFile, 0.95);
  seedFeatureAsset(db, 'feature:login', repoFile, 0.85);
  seedFeatureAsset(db, 'feature:login', testFile, 0.95);
  seedFeatureAsset(db, 'feature:login', endpoint, 1);

  // Anchors become DECLARED candidates (traversal origin).
  seedCandidate(db, {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/auth/login-handler.ts',
    relation: 'owns',
    status: 'declared',
    score: 1,
    distance: 0,
    fanIn: 1,
  });
  // Human-confirmed ownership outranks suggestions.
  seedCandidate(db, {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/auth/auth-service.ts',
    relation: 'owns',
    status: 'accepted',
    score: 0.92,
    distance: 1,
    fanIn: 2,
  });
  seedCandidate(db, {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/auth/user-repository.ts',
    relation: 'owns',
    status: 'suggested',
    score: 0.8,
    distance: 2,
    fanIn: 2,
  });
  // Shared infrastructure: high fan-in, low score → down-weighted.
  seedCandidate(db, {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/shared/logger.ts',
    relation: 'DEPENDS_ON',
    status: 'suggested',
    score: 0.52,
    distance: 1,
    fanIn: 4,
  });
  // Rejected relations must never enter a context.
  seedCandidate(db, {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/shared/http-client.ts',
    relation: 'DEPENDS_ON',
    status: 'rejected',
    score: 0.6,
  });

  seedBelongsToEvidence(db, 'feature:login', 'src/auth/login-handler.ts', 1, 'typescript', 'deterministic');
  seedBelongsToEvidence(db, 'feature:login', 'src/auth/auth-service.ts', 0.95, 'typescript');
  seedBelongsToEvidence(db, 'feature:login', 'src/auth/login.test.ts', 0.95, 'typescript');
  seedBelongsToEvidence(db, 'feature:login', 'src/api/login.ts', 1, 'express', 'deterministic');
  // fan-in: four different files import logger.
  for (const from of [
    'src/auth/auth-service.ts',
    'src/billing/invoice-service.ts',
    'src/notification/notification-service.ts',
    'src/dashboard/dashboard-service.ts',
  ]) {
    seedImports(db, from, 'src/shared/logger.ts');
  }
  seedSymbol(db, 'src/auth/auth-service.ts', 'login', 'function', 12, 18);
  seedInstruction(db, 'feature:login', '登录与鉴权逻辑必须通过 auth-service 处理', {
    level: 'required',
    scope: 'src/auth',
  });
  seedInstruction(db, 'feature:login', '避免在 handler 中直接访问用户仓库', {
    level: 'recommended',
    scope: 'src/auth',
    documentPath: 'docs/architecture.md',
  });
}

function ids(entries: Array<{ id: string }>): Set<string> {
  return new Set(entries.map((e) => e.id));
}

function allContextIds(context: FeatureContext): string[] {
  return [
    ...context.entryPoints,
    ...context.coreCode,
    ...context.dependencies,
    ...context.dependents,
    ...context.tests,
  ].map((e) => e.id);
}

describe('S1 simple-login — ranking & evidence quality', () => {
  it('ranks accepted above suggested, anchors tier 1, rejected never present', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000 });

    const core = ctx.coreCode;
    const byId = new Map(core.map((e) => [e.id, e]));
    expect(byId.get('src/auth/login-handler.ts')?.tier).toBe(1);
    expect(byId.get('src/auth/login-handler.ts')?.isAnchor).toBe(true);

    const accepted = byId.get('src/auth/auth-service.ts')!;
    const suggested = byId.get('src/auth/user-repository.ts')!;
    expect(accepted.status).toBe('accepted');
    expect(suggested.status).toBe('suggested');
    expect(accepted.score).toBeGreaterThan(suggested.score);
    // Same tier grouping: accepted (tier 1) vs suggested distance-2 (tier 2)
    expect(accepted.tier).toBe(1);
    expect(suggested.tier).toBeLessThanOrEqual(2);

    // Rejected relation must not appear anywhere.
    expect(allContextIds(ctx)).not.toContain('src/shared/http-client.ts');

    // Claims main entrypoint.
    expect(ctx.entryPoints.some((e) => e.kind === 'endpoint')).toBe(true);
    expect(ctx.purpose).toContain('用户登录认证');
  });

  it('drops shared infra from core code (fan-in ≥ 3 penalty)', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000 });
    expect(ctx.coreCode.map((e) => e.id)).not.toContain('src/shared/logger.ts');
    const logger = ctx.dependencies.find((e) => e.id === 'src/shared/logger.ts');
    expect(logger).toBeDefined();
    expect(logger!.fanIn).toBeGreaterThanOrEqual(3);
    // Down-weighted after RELATION_WEIGHT (0.52 * 0.85 status * 0.55 dep).
    expect(logger!.score).toBeLessThan(0.3);
  });

  it('every included entry carries evidence', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000 });
    for (const e of [...ctx.entryPoints, ...ctx.coreCode, ...ctx.dependencies, ...ctx.tests]) {
      expect(e.evidence.length).toBeGreaterThan(0);
    }
    expect(ctx.evidence.length).toBeGreaterThan(0);
  });

  it('includeTests=false removes the tests section but keeps core', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000, includeTests: false });
    expect(ctx.tests).toHaveLength(0);
    expect(ctx.coreCode.length).toBeGreaterThan(0);
  });

  it('policies and constraints project from scoped instructions', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000 });
    expect(ctx.policies.map((p) => p.text)).toContain('登录与鉴权逻辑必须通过 auth-service 处理');
    expect(ctx.constraints.map((c) => c.text)).toContain('登录与鉴权逻辑必须通过 auth-service 处理');
    expect(ctx.constraints.every((c) => c.level === 'required')).toBe(true);
  });
});

describe('S2 login-with-session — cross-feature dependents', () => {
  it('files importing feature core surface as dependents', () => {
    seedLoginFeature(db);
    seedFeature(db, 'feature:session', 'Session', 'Workflow');
    seedFile(db, 'src/middleware/require-auth.ts');
    seedFile(db, 'src/session/session-service.ts');
    seedImports(db, 'src/middleware/require-auth.ts', 'src/auth/login-handler.ts');
    seedImports(db, 'src/session/session-service.ts', 'src/auth/auth-service.ts');

    const ctx = assembleContext(db, 'login', { budget: 8000 });
    const dependentIds = ctx.dependents.map((d) => d.id);
    expect(dependentIds).toContain('dependent:src/middleware/require-auth.ts');
    expect(dependentIds).toContain('dependent:src/session/session-service.ts');
    expect(ctx.dependents.every((d) => d.tier === 3)).toBe(true);
  });
});

describe('S3 shared-infrastructure — no context pollution', () => {
  it('budget keeps shared files out of a tight context', () => {
    seedLoginFeature(db);
    // 400-token budget: dependencies allocation = 80 tokens ≈ one entry.
    const ctx = assembleContext(db, 'login', { budget: 400 });
    // Either the logger fits (and something else is dropped) or logger
    // itself is dropped — but NEVER both logger and core polluting.
    expect(ctx.coreCode.map((e) => e.id)).not.toContain('src/shared/logger.ts');
    expect(ctx.budget.requested).toBe(400);
    if (ctx.budget.dropped.length > 0) {
      expect(ctx.budget.overBudget).toBe(true);
      expect(ctx.truncationNote).toBeDefined();
    }
    // No entry may leak beyond the budget (anchor guarantee aside).
    expect(ctx.budget.estimatedTotal).toBeLessThanOrEqual(400 * 1.2);
  });

  it('rejected relations are excluded even when seeded with high score', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000 });
    expect(allContextIds(ctx)).not.toContain('src/shared/http-client.ts');
    // The rejected target never shows up in dropped either (it never entered the pool).
    expect(ctx.budget.dropped).not.toContain('src/shared/http-client.ts');
  });
});

describe('S4 large-feature — token budget scaling', () => {
  const OWNED = 40;

  function seedLargeFeature(): FeatureMapDatabase {
    const dbm = db;
    seedFeature(dbm, 'feature:big', 'BigFeature', 'CRUD');
    const anchor = seedFile(dbm, 'src/big/entry.ts');
    seedFeatureAsset(dbm, 'feature:big', anchor, 1);
    seedCandidate(dbm, {
      featureId: 'feature:big',
      targetType: 'file',
      targetId: 'src/big/entry.ts',
      relation: 'owns',
      status: 'declared',
      score: 1,
      distance: 0,
    });
    for (let i = 0; i < OWNED; i += 1) {
      const path = `src/big/owned-${String(i).padStart(2, '0')}.ts`;
      const asset = seedFile(dbm, path);
      seedFeatureAsset(dbm, 'feature:big', asset, 0.9);
      seedCandidate(dbm, {
        featureId: 'feature:big',
        targetType: 'file',
        targetId: path,
        relation: i % 4 === 0 ? 'DEPENDS_ON' : 'owns',
        status: 'suggested',
        score: i % 4 === 0 ? 0.6 : 0.75,
        distance: i % 4 === 0 ? 1 : 2,
        fanIn: 2,
      });
    }
    return dbm;
  }

  it('core code survives at every budget; count grows with budget', () => {
    const dbm = seedLargeFeature();
    const at = (budget: number): FeatureContext =>
      assembleContext(dbm, 'feature:big', { budget });
    const c4 = at(4000);
    const c8 = at(8000);
    const c16 = at(16000);

    // The anchor is always included.
    for (const c of [c4, c8, c16]) {
      expect(c.entryPoints.length).toBe(0);
      expect(c.coreCode.some((e) => e.id === 'src/big/entry.ts')).toBe(true);
      expect(c.budget.estimatedTotal).toBeLessThanOrEqual(c.budget.requested * 1.2);
    }
    // Larger budget → at least as many core entries.
    expect(c16.coreCode.length).toBeGreaterThanOrEqual(c8.coreCode.length);
    expect(c8.coreCode.length).toBeGreaterThanOrEqual(c4.coreCode.length);
    // Token totals grow monotonically.
    expect(c16.budget.estimatedTotal).toBeGreaterThanOrEqual(c8.budget.estimatedTotal);
    expect(c8.budget.estimatedTotal).toBeGreaterThanOrEqual(c4.budget.estimatedTotal);
    // The 4000-budget context kept the top subset of the 16000-budget one.
    const at4 = ids(c4.coreCode);
    for (const e of c16.coreCode) {
      if (e.tier <= 1) expect(at4.has(e.id)).toBe(true);
    }
  });
});

describe('S5 monorepo-feature — paths across packages', () => {
  it('resolves files from multiple workspace packages', () => {
    seedFeature(db, 'feature:web-login', 'Web Login', 'Authentication');
    const anchor = seedFile(db, 'apps/web/src/login/handler.ts');
    const auth = seedFile(db, 'packages/auth/src/auth-service.ts');
    const ui = seedFile(db, 'apps/web/src/login/page.tsx');
    for (const [asset, conf] of [
      [anchor, 1],
      [auth, 0.95],
      [ui, 0.8],
    ] as const) {
      seedFeatureAsset(db, 'feature:web-login', asset, conf);
    }
    seedCandidate(db, {
      featureId: 'feature:web-login',
      targetType: 'file',
      targetId: 'apps/web/src/login/handler.ts',
      relation: 'owns',
      status: 'declared',
      score: 1,
    });
    seedSymbol(db, 'packages/auth/src/auth-service.ts', 'login', 'function', 5, 9);
    seedCandidate(db, {
      featureId: 'feature:web-login',
      targetType: 'symbol',
      targetId: 'packages/auth/src/auth-service.ts:login',
      relation: 'owns',
      status: 'accepted',
      score: 0.95,
      distance: 1,
    });

    const ctx = assembleContext(db, 'web-login', { budget: 8000 });
    const files = ctx.coreCode.map((e) => e.file);
    expect(files).toContain('apps/web/src/login/handler.ts');
    expect(files).toContain('apps/web/src/login/page.tsx');
    // Symbol entry resolved through the symbols table.
    const sym = ctx.coreCode.find((e) => e.id === 'packages/auth/src/auth-service.ts:login');
    expect(sym).toBeDefined();
    expect(sym!.file).toBe('packages/auth/src/auth-service.ts');
    expect(sym!.name).toBe('login');
    expect(sym!.symbolType).toBe('function');
    expect(sym!.span).toBe('packages/auth/src/auth-service.ts:5-9');
    // A file covered by a symbol-level candidate never duplicates as a
    // background "owns" asset (regression: t1 symbol + t3 file dupe).
    expect(ctx.coreCode.filter((e) => e.file === 'packages/auth/src/auth-service.ts')).toHaveLength(1);
  });
});

describe('S6 task-aware-login — task changes ranking, never the graph', () => {
  function seedTaskFeature(): void {
    seedLoginFeature(db);
    // Session machinery relevant to the task.
    const sessionFile = seedFile(db, 'src/session/session-service.ts');
    const tokenFile = seedFile(db, 'src/session/token.ts');
    const cssFile = seedFile(db, 'src/login/login-styles.css');
    for (const [asset, conf] of [
      [sessionFile, 0.9],
      [tokenFile, 0.85],
      [cssFile, 0.6],
    ] as const) {
      seedFeatureAsset(db, 'feature:login', asset, conf);
    }
    seedCandidate(db, {
      featureId: 'feature:login',
      targetType: 'file',
      targetId: 'src/session/session-service.ts',
      relation: 'owns',
      status: 'suggested',
      score: 0.8,
      distance: 2,
      fanIn: 1,
    });
    seedCandidate(db, {
      featureId: 'feature:login',
      targetType: 'file',
      targetId: 'src/session/token.ts',
      relation: 'DEPENDS_ON',
      status: 'suggested',
      score: 0.7,
      distance: 1,
      fanIn: 2,
    });
    seedCandidate(db, {
      featureId: 'feature:login',
      targetType: 'file',
      targetId: 'src/login/login-styles.css',
      relation: 'owns',
      status: 'suggested',
      score: 0.55,
      distance: 3,
      fanIn: 1,
    });
    seedCommit(db, {
      sha: 'c1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      message: 'fix: session expiration after login',
      committedAt: '2026-09-01T10:00:00Z',
      paths: ['src/session/session-service.ts', 'src/session/token.ts'],
    });
    seedSymbol(db, 'src/session/session-service.ts', 'refresh', 'function', 20, 26);
  }

  it('task boost reorders session code above unrelated code', () => {
    seedTaskFeature();

    const plain = assembleContext(db, 'login', { budget: 8000 });
    const withTask = assembleContext(db, 'login', {
      budget: 8000,
      task: 'fix session expiration',
    });

    const score = (ctx: FeatureContext, id: string): number =>
      ctx.coreCode.find((e) => e.id === id)?.score ?? -1;
    const session = 'src/session/session-service.ts';

    // Without a task, the accepted owns file outranks the suggested session file.
    expect(score(plain, 'src/auth/auth-service.ts')).toBeGreaterThan(score(plain, session));
    // With the task, the session file moves to the top of its tier.
    expect(score(withTask, session)).toBeGreaterThan(score(plain, session));
    expect(withTask.coreCode.find((e) => e.id === session)?.taskMatched).toBe(true);
    expect(withTask.task).toBeDefined();
    expect(withTask.task!.boostsApplied).toBeGreaterThan(0);
    // The graph is untouched: feature assets and candidates are unchanged.
    const before = plain.coreCode.length;
    expect(withTask.coreCode.length).toBe(before);
  });

  it('task relevance surfaces in recent changes and risks', () => {
    seedTaskFeature();
    const withTask = assembleContext(db, 'login', { budget: 8000, task: 'fix session expiration' });
    expect(withTask.recentChanges.some((c) => c.taskMatched)).toBe(true);
    expect(withTask.changeRisks.some((r) => r.id === 'risk:fix-commits')).toBe(true);
    // Core changed but the feature's test did not move.
    expect(withTask.changeRisks.some((r) => r.id === 'risk:tests-unchanged')).toBe(true);
  });

  it('task orders session code above unrelated UI code and marks it', () => {
    seedTaskFeature();
    const full = assembleContext(db, 'login', { budget: 8000, task: 'fix session expiration' });

    const s2 = full.coreCode.find((e) => e.id === 'src/session/session-service.ts')!;
    const c2 = full.coreCode.find((e) => e.id === 'src/login/login-styles.css')!;
    const auth = full.coreCode.find((e) => e.id === 'src/auth/auth-service.ts')!;
    expect(s2).toBeDefined();
    expect(c2).toBeDefined();

    // Task boost lifts session code: session outranks pure-login background,
    // and is explicitly marked.
    expect(s2.score).toBeGreaterThan(c2.score);
    expect(s2.score).toBeGreaterThan(auth.score);
    expect(s2.tier).toBeLessThan(c2.tier);
    expect(full.coreCode.indexOf(s2)).toBeLessThan(full.coreCode.indexOf(c2));
    expect(s2.taskMatched).toBe(true);
    expect(c2.taskMatched ?? false).toBe(false);

    // Without a task the accepted ownership fact outranks the session file.
    const plain = assembleContext(db, 'login', { budget: 8000 });
    const pScore = (id: string): number => plain.coreCode.find((e) => e.id === id)?.score ?? -1;
    expect(pScore('src/auth/auth-service.ts')).toBeGreaterThan(pScore(s2.id));
  });
});

describe('Budget distribution & redistribution', () => {
  it('redistributes satiated-section budget to hungry sections', () => {
    seedLoginFeature(db);
    // No dependents seeded here → dependents budget reallocated elsewhere;
    // policies present so the policies section is non-empty.
    const ctx = assembleContext(db, 'login', { budget: 2000 });
    const maxParts = [
      ...ctx.dependencies,
      ...ctx.coreCode,
      ...ctx.tests,
      ...ctx.recentChanges,
    ];
    expect(maxParts.length).toBeGreaterThan(0);
  });

  it('budget selection is monotone: nothing included at a small budget is dropped at a bigger one', () => {
    seedLoginFeature(db);
    const idsOf = (ctx: FeatureContext): Set<string> =>
      new Set([
        ...ctx.entryPoints,
        ...ctx.coreCode,
        ...ctx.dependencies,
        ...ctx.dependents,
        ...ctx.tests,
      ].map((e) => e.id));
    const small = idsOf(assembleContext(db, 'login', { budget: 300 }));
    const big = idsOf(assembleContext(db, 'login', { budget: 16000 }));
    for (const id of small) expect(big.has(id)).toBe(true);
  });

  it('includeHistory=false removes recent changes and their risks', () => {
    seedLoginFeature(db);
    seedCommit(db, {
      sha: 'c2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      message: 'feat: add login flow',
      committedAt: '2026-09-01T09:00:00Z',
      paths: ['src/auth/login-handler.ts'],
    });
    const withHistory = assembleContext(db, 'login', { budget: 8000 });
    expect(withHistory.recentChanges.length).toBeGreaterThan(0);
    expect(withHistory.budget.dropped).not.toContain('c2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    const noHistory = assembleContext(db, 'login', { budget: 8000, includeHistory: false });
    expect(noHistory.recentChanges).toHaveLength(0);
    // History-driven risk signals disappear with their source.
    expect(noHistory.changeRisks.some((r) => r.id === 'risk:anchor-changes')).toBe(false);
  });
});

describe('Renderers — formats share the model', () => {
  it('JSON output is stable and versioned', () => {
    seedLoginFeature(db);
    const ctx = assembleContext(db, 'login', { budget: 8000, format: 'json' });
    const json = renderJson(ctx) as Record<string, unknown>;
    expect(json['schemaVersion']).toBe('1');
    expect(json['feature']).toBeDefined();
    for (const key of ['entryPoints', 'coreCode', 'dependencies', 'tests', 'policies', 'recentChanges', 'risks', 'evidence', 'budget']) {
      expect(Array.isArray(json[key]) || typeof json[key] === 'object').toBe(true);
      expect(json[key]).toBeDefined();
    }
    const core = json['coreCode'] as Array<Record<string, unknown>>;
    expect(core.every((e) => typeof e['id'] === 'string' && Array.isArray(e['evidence']))).toBe(true);
    // Deterministic: same input → same JSON. Reachability details
    // (generatedBy.timestamp) are build metadata, excluded from parity.
    const ctx2 = assembleContext(db, 'login', { budget: 8000, format: 'json' });
    const json2 = renderJson(ctx2);
    expect(stripTimestamp(json2)).toEqual(stripTimestamp(json));
  });

  it('markdown and agent renderers both emit the feature header', () => {
    seedLoginFeature(db);
    const md = renderMarkdown(assembleContext(db, 'login', { budget: 8000 }));
    expect(md).toContain('# Feature Context: Login');
    expect(md).toContain('## Core Implementation');

    const agent = renderAgent(assembleContext(db, 'login', { budget: 8000 }));
    expect(agent).toContain('# Feature Context: Login');
    expect(agent).toContain('## Recommended Files To Inspect');
    expect(agent).toContain('## Purpose');
    expect(agent).toContain('## Entry Points');

    // Agent output distinguishes facts from inference somewhere.
    expect(agent).toContain('ev:');
  });

  it('renderContext dispatches by format', () => {
    seedLoginFeature(db);
    const j = renderContext(assembleContext(db, 'login', { format: 'json' }), 'json');
    expect(typeof j).toBe('object');
    const m = renderContext(assembleContext(db, 'login', { format: 'markdown' }), 'markdown');
    expect(typeof m).toBe('string');
    const a = renderContext(assembleContext(db, 'login', { format: 'agent' }), 'agent');
    expect(typeof a).toBe('string');
  });
});

describe('buildFeatureContext — public API surface', () => {
  it('throws FeatureContextError for unknown features with a clear code', () => {
    seedLoginFeature(db);
    expect(() => assembleContext(db, 'nope', {})).toThrowError(/不存在/);
    try {
      assembleContext(db, 'nope', {});
      expect.unreachable('expected an error');
    } catch (err) {
      const e = err as { code?: string };
      expect(e.code).toBe('FEATURE_NOT_FOUND');
    }
  });

  it('resolves a resolved feature by slug and by name', () => {
    seedLoginFeature(db);
    const bySlug = assembleContext(db, 'Login', { budget: 8000 });
    expect(bySlug.feature.id).toBe('feature:login');
    const byId = assembleContext(db, 'feature:login', { budget: 8000 });
    expect(byId.feature.id).toBe('feature:login');
  });
});