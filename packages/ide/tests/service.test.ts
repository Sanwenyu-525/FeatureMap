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
