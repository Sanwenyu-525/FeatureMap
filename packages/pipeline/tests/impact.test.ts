/**
 * Impact traversal tests — Milestone 4.
 *
 * Traversal must start from Git changes and follow only
 * evidence-backed relations (AGENTS.md §9).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { analyzeImpact } from '../src/impact.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

let dbPath: string;
let closeDb: () => void;

beforeAll(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'featuremap-impact-')), 'featuremap.db');
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects)
    .values({ id: 'p1', name: 'demo', root: fixtureRoot, baseBranch: 'main' })
    .run();
  db.insert(schema.commits)
    .values({ sha: 'WORKING_TREE', projectId: 'p1', message: 'Working tree changes' })
    .run();

  const file = (path: string) => ({
    id: assetId({ type: 'file', path }),
    projectId: 'p1',
    path,
  });
  for (const path of [
    'src/app.js',
    'src/auth/login.js',
    'src/auth/user.js',
    'README.md',
  ]) {
    db.insert(schema.files).values(file(path)).run();
  }
  for (const [path] of [
    ['src/app.js'],
    ['src/auth/login.js'],
    ['src/auth/user.js'],
  ]) {
    db.insert(schema.assets)
      .values({ id: assetId({ type: 'file', path }), type: 'file', path })
      .run();
  }
  db.insert(schema.documents)
    .values({ id: 'README.md', path: 'README.md', type: 'readme' })
    .run();

  db.insert(schema.features)
    .values({
      id: 'feature:login',
      name: 'Login',
      pattern: 'Authentication',
      confidence: 0.9,
      health: { implementation: 'complete', tests: 'missing', documentation: 'present' },
    })
    .run();
  for (const [path, confidence] of [
    ['src/auth/login.js', 0.9],
    ['src/auth/user.js', 0.9],
  ] as const) {
    db.insert(schema.featureAssets)
      .values({
        featureId: 'feature:login',
        assetId: assetId({ type: 'file', path }),
        confidence,
      })
      .run();
  }

  // src/auth/login.js imports src/auth/user.js (deterministic evidence)
  db.insert(schema.evidence)
    .values({
      id: 'e_imports',
      sourceType: 'file',
      sourceId: 'src/auth/login.js',
      relationType: 'IMPORTS',
      targetType: 'file',
      targetId: 'src/auth/user.js',
      confidence: 1.0,
      analyzerId: 'typescript',
      origin: 'deterministic',
    })
    .run();
  // README describes the changed handler file
  db.insert(schema.evidence)
    .values({
      id: 'e_described',
      sourceType: 'file',
      sourceId: 'src/auth/login.js',
      relationType: 'DESCRIBED_BY',
      targetType: 'document',
      targetId: 'README.md',
      confidence: 1.0,
      analyzerId: 'markdown',
      origin: 'deterministic',
    })
    .run();

  // Current change set: handler and data-access files changed
  db.insert(schema.commitFiles)
    .values({ commitSha: 'WORKING_TREE', path: 'src/auth/login.js', changeType: 'modified' })
    .run();
  db.insert(schema.commitFiles)
    .values({ commitSha: 'WORKING_TREE', path: 'src/auth/user.js', changeType: 'modified' })
    .run();

  closeDb = () => sqlite.close();
});

afterAll(() => {
  closeDb();
  rmSync(join(tmpdir(), 'featuremap-impact-'), { recursive: true, force: true });
});

describe('analyzeImpact', () => {
  it('maps changed files to directly affected features', () => {
    const result = analyzeImpact(fixtureRoot, dbPath);
    const login = result.affectedFeatures.find((f) => f.featureId === 'feature:login');
    expect(login).toBeDefined();
    expect(login?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(login?.reasons.join(' ')).toContain('src/auth/login.js');
  });

  it('traverses reverse IMPORTS with penalised confidence', () => {
    const result = analyzeImpact(fixtureRoot, dbPath);
    const login = result.affectedFeatures.find((f) => f.featureId === 'feature:login');
    expect(login?.confidence).toBeLessThanOrEqual(0.9);
    // The transitive reason for user.js must be present somewhere.
    const hasTransitiveReason = result.affectedFeatures.some((f) =>
      f.reasons.some((r) => r.includes('transitive')),
    );
    expect(hasTransitiveReason).toBe(true);
  });

  it('flags documentation described by stale evidence', () => {
    const result = analyzeImpact(fixtureRoot, dbPath);
    expect(result.potentiallyStaleDocuments.map((d) => d.path)).toContain('README.md');
  });

  it('excludes unknown files from impact', () => {
    const result = analyzeImpact(fixtureRoot, dbPath);
    expect(result.changedFiles.map((c) => c.path)).not.toContain('unknown.txt');
  });
});
