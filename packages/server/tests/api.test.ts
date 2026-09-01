/**
 * Local API contract tests — docs/API_SPEC.md contracts exercised
 * end-to-end: pipeline scan → SQLite → Fastify responses.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '@featuremap/pipeline';
import { buildServer } from '../src/app.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

let dbPath: string;
let app: ReturnType<typeof buildServer>;

beforeAll(async () => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'featuremap-api-')), 'featuremap.db');
  await runScan(fixtureRoot, { dbPath });
  app = buildServer({ repoRoot: fixtureRoot, dbPath });
});

afterAll(async () => {
  await app.close();
  rmSync(dirname(dbPath), { recursive: true, force: true });
});

describe('GET /api/project', () => {
  it('returns project metadata with technologies', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/project' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { name: string; technologies: unknown[] };
    expect(body.name).toBe('react-express-basic');
    expect(body.technologies.length).toBeGreaterThan(0);
  });
});

describe('GET /api/overview', () => {
  it('returns counts from the scan', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/overview' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { counts: Record<string, number> };
    expect(body.counts.files).toBeGreaterThan(0);
    expect(body.counts.endpoints).toBe(3);
    expect(body.counts.documents).toBe(1);
  });
});

describe('GET /api/features', () => {
  it('returns discovered features with pattern and derived health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/features' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      pattern: string;
      confidence: number;
      health?: Record<string, string>;
    }>;
    const login = body.find((f) => f.id === 'feature:login');
    expect(login).toBeDefined();
    expect(login?.pattern).toBe('Authentication');
    expect(login?.health?.['implementation']).toBe('complete');
  });
});

describe('GET /api/features/:id', () => {
  it('returns the full feature detail with assets, documents and evidence', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/features' });
    const first = (list.json() as Array<{ id: string }>)[0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/features/${encodeURIComponent(first.id)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      id: string;
      assets: unknown[];
      evidence: unknown[];
      health?: Record<string, string>;
    };
    expect(body.id).toBe(first.id);
    expect(body.assets.length).toBeGreaterThan(0);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.health?.['implementation']).toBeDefined();
  });

  it('returns the documented FEATURE_NOT_FOUND error envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/features/nope' });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FEATURE_NOT_FOUND');
  });
});

describe('GET /api/changes', () => {
  it('returns the change set shape with empty affected features', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/changes' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { changedFiles: unknown[]; affectedFeatures: unknown[]; baseBranch: string };
    expect(body.changedFiles).toEqual([]); // fixture working tree is clean
    expect(body.affectedFeatures).toEqual([]);
    expect(body.baseBranch).toBe('main');
  });
});

describe('GET /api/analyzers', () => {
  it('reports the analyzer runs of the latest scan', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analyzers' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ analyzerId: string; status: string }>;
    const ids = body.map((a) => a.analyzerId);
    expect(ids).toContain('typescript');
    expect(ids).toContain('express');
    expect(ids).toContain('prisma');
  });
});

describe('POST /api/features/:id/candidates/verdict', () => {
  it('records a verdict and reflects it in the feature detail', async () => {
    const detailUrl = `/api/features/${encodeURIComponent('feature:login')}`;
    const before = await app.inject({ method: 'GET', url: detailUrl });
    const { candidates } = before.json() as {
      candidates: Array<{ targetId: string; status: string }>;
    };
    const suggested = candidates.find((c) => c.status === 'suggested');
    expect(suggested).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `${detailUrl}/candidates/verdict`,
      payload: { targetId: suggested!.targetId, verdict: 'rejected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'rejected', targetId: suggested!.targetId });

    const after = await app.inject({ method: 'GET', url: detailUrl });
    const afterCandidates = (after.json() as {
      candidates: Array<{ targetId: string; status: string }>;
    }).candidates;
    expect(afterCandidates.find((c) => c.targetId === suggested!.targetId)?.status).toBe('rejected');
  });

  it('rejects invalid verdict values and unknown targets', async () => {
    const url = `/api/features/${encodeURIComponent('feature:login')}/candidates/verdict`;
    const badVerdict = await app.inject({
      method: 'POST',
      url,
      payload: { targetId: 'src/auth/login.js', verdict: 'maybe' },
    });
    expect(badVerdict.statusCode).toBe(400);
    expect(badVerdict.json().error.code).toBe('INVALID_CONFIG');

    const unknown = await app.inject({
      method: 'POST',
      url,
      payload: { targetId: 'src/does-not-exist.js', verdict: 'rejected' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('CANDIDATE_NOT_FOUND');
  });
});
