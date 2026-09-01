/**
 * MCP tool tests — docs/MCP_SPEC.md contracts exercised against the
 * react-express-basic fixture (bounded output, ranking, no invention).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '@featuremap/pipeline';
import {
  getAffectedFeatures,
  getApplicableInstructions,
  getFeature,
  getFeatureContext,
  listFeatures,
  type ToolContext,
} from '../src/index.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

let ctx: ToolContext;
let tempDir: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'featuremap-mcp-'));
  const dbPath = join(tempDir, 'featuremap.db');
  await runScan(fixtureRoot, { dbPath });
  ctx = { repoRoot: fixtureRoot, dbPath };
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('list_features', () => {
  it('lists discovered features with confidence', async () => {
    const features = (await listFeatures(ctx)) as Array<{ id: string; pattern: string; confidence: number }>;
    const ids = features.map((f) => f.id);
    expect(ids).toContain('feature:login');
    expect(ids).toContain('feature:users');
  });

  it('filters by query', async () => {
    const features = (await listFeatures(ctx, { query: 'login' })) as Array<{ id: string }>;
    expect(features).toHaveLength(1);
    expect(features[0]?.id).toBe('feature:login');
  });

  it('supports changedOnly filtering without error', async () => {
    const features = (await listFeatures(ctx, { changedOnly: true })) as unknown[];
    expect(Array.isArray(features)).toBe(true);
  });
});

describe('get_feature', () => {
  it('returns metadata and derived health', async () => {
    const feature = (await getFeature(ctx, { featureId: 'feature:login' })) as {
      name: string;
      health?: Record<string, string>;
    };
    expect(feature.name).toBe('Login');
    expect(feature.health?.['implementation']).toBe('complete');
  });

  it('returns FEATURE_NOT_FOUND for unknown ids', async () => {
    const result = (await getFeature(ctx, { featureId: 'nope' })) as { error?: { code: string } };
    expect(result.error?.code).toBe('FEATURE_NOT_FOUND');
  });
});

describe('get_feature_context', () => {
  it('returns bounded, ranked context sections', async () => {
    const context = (await getFeatureContext(ctx, {
      featureId: 'feature:login',
      maxItemsPerSection: 5,
    })) as {
      feature: { id: string };
      sections: { code: unknown[]; apis: Array<{ name: string }>; instructions: unknown[] };
      evidenceSummary: unknown[];
    };
    expect(context.feature.id).toBe('feature:login');
    expect(context.sections.apis.map((a) => a.name)).toContain('POST /api/login');
    expect(context.sections.code.length).toBeLessThanOrEqual(5);
    // No invented rules: instruction extraction is not implemented yet.
    expect(context.sections.instructions).toEqual([]);
  });

  it('honours include selection', async () => {
    const context = (await getFeatureContext(ctx, {
      featureId: 'feature:login',
      include: ['apis'],
    })) as { sections: { apis: unknown[]; code: unknown[]; documents: unknown[] } };
    expect(context.sections.apis.length).toBeGreaterThan(0);
    expect(context.sections.code).toEqual([]);
    expect(context.sections.documents).toEqual([]);
  });

  it('returns FEATURE_NOT_FOUND for unknown ids', async () => {
    const result = (await getFeatureContext(ctx, { featureId: 'nope' })) as { error?: { code: string } };
    expect(result.error?.code).toBe('FEATURE_NOT_FOUND');
  });
});

describe('get_affected_features', () => {
  it('returns an array ranked by confidence', async () => {
    const affected = (await getAffectedFeatures(ctx)) as Array<{ confidence: number }>;
    expect(Array.isArray(affected)).toBe(true);
    const confidences = affected.map((f) => f.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
  });
});

describe('get_applicable_instructions', () => {
  it('returns empty list until instruction extraction exists (no invention)', async () => {
    const instructions = await getApplicableInstructions(ctx, { featureId: 'feature:login' });
    expect(instructions).toEqual([]);
  });
});
