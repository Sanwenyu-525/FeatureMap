/**
 * Review service tests (v0.6.4 plan §65–§66).
 *
 * suggestions.list ranking/DTO, the optimistic fingerprint check, and
 * verdict persistence through the single setVerdict writer.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import {
  applyReviewVerdict,
  explainReviewRelation,
  listSuggestedRelations,
} from '../src/review-service.js';

const repo = '/tmp/review-svc';
let dir: string;
let dbPath: string;

function seed(): void {
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects).values({ id: 'p', name: 't', root: repo }).run();
  for (const path of ['src/a.ts', 'src/b.ts']) {
    db.insert(schema.files).values({ id: assetId({ type: 'file', path }), projectId: 'p', path }).run();
  }
  db.insert(schema.features).values([
    { id: 'feature:a', name: 'A', pattern: 'CRUD', confidence: 0.9 },
    { id: 'feature:b', name: 'B', pattern: 'Workflow', confidence: 0.9 },
  ]).run();
  const chain = [{ relationType: 'IMPORTS', sourceId: 'src/a.ts', targetId: 'src/shared/x.ts', confidence: 1 }];
  db.insert(schema.featureCandidates).values([
    { id: 'c_a_low', featureId: 'feature:a', targetType: 'file', targetId: 'src/a.ts', relation: 'owns', status: 'suggested', score: 0.6, distance: 2, fanIn: 1, evidenceChain: chain, fingerprint: 'fp_a_low' },
    { id: 'c_a_high', featureId: 'feature:a', targetType: 'file', targetId: 'src/b.ts', relation: 'DEPENDS_ON', status: 'suggested', score: 0.95, distance: 1, fanIn: 1, evidenceChain: chain, fingerprint: 'fp_a_high' },
    { id: 'c_b', featureId: 'feature:b', targetType: 'file', targetId: 'src/b.ts', relation: 'owns', status: 'suggested', score: 0.9, distance: 1, fanIn: 1, evidenceChain: chain, fingerprint: 'fp_b' },
  ]).run();
  sqlite.close();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fm-review-svc-'));
  dbPath = join(dir, 'featuremap.db');
  seed();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listSuggestedRelations', () => {
  it('returns suggested only, ranked deterministically', () => {
    const rows = listSuggestedRelations(repo, {}, dbPath);
    const ids = rows.map((r) => r.target.id);
    // score DESC first (b.ts 0.95 > 0.9 > 0.6), ties by featureId.
    expect(ids).toEqual(['src/b.ts', 'src/b.ts', 'src/a.ts']);
    expect(rows.every((r) => r.status === 'suggested')).toBe(true);
    expect(rows[0]?.feature.name).toBe('A');
    expect(rows[0]?.relation).toBe('DEPENDS_ON');
    expect(rows[0]?.evidence.available).toBe(true);
  });

  it('filters by featureId and limit', () => {
    const rows = listSuggestedRelations(repo, { featureId: 'feature:a', limit: 1 }, dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.featureId ?? rows[0]?.feature.id).toBe('feature:a');
  });
});

describe('applyReviewVerdict', () => {
  it('accepts a suggested relation and persists it through setVerdict', () => {
    const result = applyReviewVerdict(
      repo,
      { featureId: 'feature:a', target: { type: 'file', id: 'src/b.ts' }, verdict: 'accepted' },
      dbPath,
    );
    expect(result.applied).toBe(true);
    if (result.applied) {
      expect(result.candidate.status).toBe('accepted');
    }
    // The suggestion no longer appears in the Review inbox.
    expect(listSuggestedRelations(repo, {}, dbPath).some((r) => r.target.id === 'src/b.ts' && r.feature.id === 'A')).toBe(false);
  });

  it('rejects when the fingerprint moved on (optimistic concurrency, plan §66)', () => {
    const result = applyReviewVerdict(
      repo,
      { featureId: 'feature:b', target: { type: 'file', id: 'src/b.ts' }, verdict: 'rejected', expectedFingerprint: 'stale' },
      dbPath,
    );
    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toBe('candidate_changed');
    }
    // The real candidate is untouched.
    expect(listSuggestedRelations(repo, { featureId: 'feature:b' }, dbPath)).toHaveLength(1);
  });

  it('never applies a verdict to a relation that is not a current suggestion', () => {
    const result = applyReviewVerdict(
      repo,
      { featureId: 'feature:a', target: { type: 'file', id: 'src/missing.ts' }, verdict: 'rejected' },
      dbPath,
    );
    expect(result.applied).toBe(false);
  });
});

describe('explainReviewRelation', () => {
  it('reuses the stored evidence chain', () => {
    const result = explainReviewRelation(repo, 'feature:a', { type: 'file', id: 'src/a.ts' }, dbPath);
    expect(result.feature.id).toBe('feature:a');
    expect(result.relation).toBe('OWNS');
    expect(result.evidenceChain.length).toBeGreaterThan(0);
  });
});
