/**
 * Drift tests (v0.6.4 plan §56–§64).
 *
 * The shared computeDrift is the single engine for both the PR report
 * (ADR-0005) and the IDE diagnostics. These tests pin: pure detection
 * rules, the end-to-end detectDrift (working-tree deletion → survivor
 * location), and PR↔IDE parity on the same fixture.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { buildPrReport } from '../src/pr-report.js';
import { computeDrift, type DriftInput } from '../src/drift/compute-drift.js';
import { detectDrift } from '../src/drift/detect-drift.js';

/**
 * Seed a store the way a scan would, including a WORKING_TREE commit
 * that records src/auth/login.ts as deleted while the confirmed
 * (declared) relation for it still exists — the relation_broken input.
 */
function seedDriftStore(dbPath: string, repo: string): void {
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects).values({ id: 'p1', name: 'drift', root: repo, baseBranch: 'main' }).run();
  const filePath = 'src/auth/login.ts';
  db.insert(schema.files).values({ id: assetId({ type: 'file', path: filePath }), projectId: 'p1', path: filePath }).run();
  db.insert(schema.assets).values({ id: assetId({ type: 'file', path: filePath }), type: 'file', path: filePath }).run();
  db.insert(schema.features)
    .values({ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9 })
    .run();
  db.insert(schema.featureAssets).values({ featureId: 'feature:login', assetId: assetId({ type: 'file', path: filePath }), confidence: 1 }).run();
  db.insert(schema.featureCandidates)
    .values({
      id: 'c_login_anchor',
      featureId: 'feature:login',
      targetType: 'file',
      targetId: filePath,
      relation: 'owns',
      status: 'declared',
      score: 1,
      fingerprint: 'f1',
    })
    .run();
  db.insert(schema.commits).values({ sha: 'WORKING_TREE', projectId: 'p1', message: 'Working tree changes' }).run();
  db.insert(schema.commitFiles).values({ commitSha: 'WORKING_TREE', path: filePath, changeType: 'deleted' }).run();
  sqlite.close();
}

function input(overrides: Partial<DriftInput> = {}): DriftInput {
  return {
    confirmed: [],
    changeTypeByPath: new Map(),
    changedSymbols: [],
    ownedFilesByFeature: new Map(),
    testPaths: new Set(),
    featureNames: new Map(),
    ...overrides,
  };
}

describe('computeDrift (pure, plan §57–§64)', () => {
  it('relation_broken fires when a confirmed file is deleted', () => {
    const issues = computeDrift(
      input({
        confirmed: [{ featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login.ts', status: 'declared', score: 1, fingerprint: null }],
        changeTypeByPath: new Map([['src/auth/login.ts', 'deleted']]),
        featureNames: new Map([['feature:login', 'Login']]),
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('relation_broken');
    expect(issues[0]?.featureId).toBe('feature:login');
    expect(issues[0]?.targetId).toBe('src/auth/login.ts');
  });

  it('relation_broken also fires for renamed files', () => {
    const issues = computeDrift(
      input({
        confirmed: [{ featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login.ts', status: 'accepted', score: 1, fingerprint: 'f' }],
        changeTypeByPath: new Map([['src/auth/login.ts', 'renamed']]),
      }),
    );
    expect(issues.map((i) => i.kind)).toEqual(['relation_broken']);
  });

  it('does not fire relation_broken for modified files', () => {
    const issues = computeDrift(
      input({
        confirmed: [{ featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login.ts', status: 'accepted', score: 1, fingerprint: null }],
        changeTypeByPath: new Map([['src/auth/login.ts', 'modified']]),
      }),
    );
    expect(issues).toEqual([]);
  });

  it('new_candidate fires for a changed symbol in an owned file that is not confirmed', () => {
    const issues = computeDrift(
      input({
        confirmed: [{ featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login.ts', status: 'declared', score: 1, fingerprint: null }],
        ownedFilesByFeature: new Map([['feature:login', new Set(['src/auth/login.ts'])]]),
        changedSymbols: [{ path: 'src/auth/login.ts', name: 'refreshToken', symbolId: 'symbol:src/auth/login.ts:refreshToken' }],
        featureNames: new Map([['feature:login', 'Login']]),
      }),
    );
    expect(issues.map((i) => i.kind)).toEqual(['new_candidate']);
    expect(issues[0]?.targetId).toBe('symbol:src/auth/login.ts:refreshToken');
  });

  it('does not re-suggest an already confirmed symbol (plan §5.2)', () => {
    const issues = computeDrift(
      input({
        confirmed: [
          { featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login.ts', status: 'declared', score: 1, fingerprint: null },
          { featureId: 'feature:login', targetType: 'symbol', targetId: 'src/auth/login.ts:login', status: 'accepted', score: 1, fingerprint: 'f' },
        ],
        ownedFilesByFeature: new Map([['feature:login', new Set(['src/auth/login.ts'])]]),
        changedSymbols: [{ path: 'src/auth/login.ts', name: 'login', symbolId: 'symbol:src/auth/login.ts:login' }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('ignores changed symbols in test files', () => {
    const issues = computeDrift(
      input({
        ownedFilesByFeature: new Map([['feature:login', new Set(['src/auth/login.ts'])]]),
        testPaths: new Set(['src/auth/login.ts']),
        changedSymbols: [{ path: 'src/auth/login.ts', name: 'x', symbolId: 'symbol:src/auth/login.ts:x' }],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('is deterministic and issueCount equals issues.length', () => {
    const base = input({
      confirmed: [{ featureId: 'feature:a', targetType: 'file', targetId: 'a.ts', status: 'accepted', score: 1, fingerprint: null }],
      changeTypeByPath: new Map([['a.ts', 'deleted']]),
    });
    const first = computeDrift(base);
    const second = computeDrift(base);
    expect(first).toEqual(second);
  });
});

describe('detectDrift (seeded working-tree deletion)', () => {
  it('reports relation_broken with a surviving location', async () => {
    const base = mkdtempSync(join(tmpdir(), 'featuremap-drift-'));
    const repo = join(base, 'repo');
    try {
      const dbPath = join(base, 'featuremap.db');
      seedDriftStore(dbPath, repo);

      const report = await detectDrift(repo, { dbPath });
      const broken = report.issues.find((i) => i.kind === 'relation_broken');
      expect(broken?.featureId).toBe('feature:login');
      expect(broken?.targetId).toBe('src/auth/login.ts');
      expect(report.summary.issueCount).toBe(report.issues.length);
      expect(report.summary.byType.relation_broken).toBe(1);
      // relation_broken resolves a surviving confirmed asset as its anchor.
      expect(broken?.location?.filePath).toBe('src/auth/login.ts');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);

  it('PR report and detectDrift share the same drift (parity, plan §56)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'featuremap-drift-parity-'));
    const repo = join(base, 'repo');
    try {
      const dbPath = join(base, 'featuremap.db');
      seedDriftStore(dbPath, repo);

      const [pr, drift] = await Promise.all([
        buildPrReport(repo, { dbPath }),
        detectDrift(repo, { dbPath }),
      ]);
      const prDrift = pr.mappingDrift.map((d) => `${d.kind}:${d.featureId}:${d.targetType}:${d.targetId}`).sort();
      const ideDrift = drift.issues.map((d) => `${d.kind}:${d.featureId}:${d.targetType}:${d.targetId}`).sort();
      expect(ideDrift.length).toBeGreaterThan(0);
      expect(prDrift).toEqual(ideDrift);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});
