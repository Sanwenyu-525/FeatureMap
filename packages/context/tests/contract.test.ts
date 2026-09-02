/**
 * Stage 0 (v0.7.0) — Contract & Location Freeze
 * (docs/DEVELOPMENT_PLAN.md Milestone 25 §Stage 0).
 *
 * `FeatureContextDocument` becomes a stable cross-surface API contract:
 * formatVersion, top-level shape, section keys, empty-section behavior,
 * Recommended Files ordering/cap, artifact semantics, deterministic
 * contextId, task normalization, read-only invariant, no source bodies,
 * canonical markdown — and the 1-based line/column convention that every
 * adapter (CLI / MCP / IDE / HTTP) must preserve without re-deriving.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase, schema } from '@featuremap/db';
import {
  buildFeatureContextDocument,
  contextIdOf,
  MAX_RECOMMENDED_FILES,
} from '../src/context-document.js';
import {
  createGoldenFixture,
  allEntries,
  CONTRACT_SECTION_KEYS,
  GOLDEN_FEATURE_ID,
} from './contract-fixture.js';
import { seedFile, seedFeature, seedFeatureAsset, seedCandidate } from './seed.js';

describe('FeatureContextDocument — contract v1', () => {
  it('pins formatVersion and the exact top-level shape', () => {
    const f = createGoldenFixture();
    try {
      expect(f.document.formatVersion).toBe(1);
      expect(Object.keys(f.document).sort()).toEqual(
        ['artifact', 'budget', 'contextId', 'feature', 'formatVersion', 'markdown', 'recommendedFiles', 'sections', 'task'].sort(),
      );
      expect(f.document.feature).toEqual({ id: 'feature:login', name: 'Login' });
      expect(f.document.budget?.requested).toBeGreaterThan(0);
      expect(f.document.budget?.estimatedTotal).toBeGreaterThanOrEqual(0);
      expect(typeof f.document.budget?.allocation).toBe('object');
    } finally {
      f.cleanup();
    }
  });

  it('keeps section keys stable and empty sections as arrays (never undefined)', () => {
    const f = createGoldenFixture();
    try {
      // Stable full key set: the 6 array sections + optional `purpose`
      // (always present as a key; undefined when the feature has none).
      const keys = Object.keys(f.document.sections).sort();
      expect(keys).toEqual([...CONTRACT_SECTION_KEYS, 'purpose'].sort());
      for (const key of CONTRACT_SECTION_KEYS) {
        expect(Array.isArray(f.document.sections[key])).toBe(true);
      }
      // This fixture has no commits / dependents → empty arrays, not omissions.
      expect(f.document.sections.changes).toEqual([]);
      expect(f.document.sections.other).toEqual([]);
      // purpose is optional; when present it is a string.
      if (f.document.sections.purpose !== undefined) {
        expect(typeof f.document.sections.purpose).toBe('string');
      }
    } finally {
      f.cleanup();
    }
  });

  it('recommended files are capped, deduped by path and ordered by ranked first-appearance', () => {
    const dir = createGoldenFixture();
    const { db, sqlite } = openDatabase(dir.dbPath);
    try {
      // Grow the feature beyond the cap: 15 owned files.
      seedFeature(db, 'feature:big', 'Big', 'CRUD');
      const anchor = seedFile(db, 'src/big/entry.ts');
      seedFeatureAsset(db, 'feature:big', anchor, 1);
      seedCandidate(db, { featureId: 'feature:big', targetType: 'file', targetId: 'src/big/entry.ts', relation: 'owns', status: 'declared', score: 1, distance: 0 });
      for (let i = 0; i < 15; i += 1) {
        const path = `src/big/owned-${String(i).padStart(2, '0')}.ts`;
        const asset = seedFile(db, path);
        seedFeatureAsset(db, 'feature:big', asset, 0.9);
        seedCandidate(db, { featureId: 'feature:big', targetType: 'file', targetId: path, relation: 'owns', status: 'suggested', score: 0.8, distance: 1 });
      }
      sqlite.close();
      const doc = buildFeatureContextDocument(dir.repoRoot, 'feature:big', { dbPath: dir.dbPath, budget: 32000 });
      const paths = doc.recommendedFiles.map((f) => f.path);
      expect(paths.length).toBeLessThanOrEqual(MAX_RECOMMENDED_FILES);
      expect(new Set(paths).size).toBe(paths.length); // dedupe
      expect(doc.recommendedFiles.every((f) => f.reason.length > 0)).toBe(true);
      expect(doc.recommendedFiles.every((f) => f.roles.length > 0)).toBe(true);
      // Order preserves ranking: the anchor stays first.
      expect(paths[0]).toBe('src/big/entry.ts');
    } finally {
      sqlite.close();
      dir.cleanup();
    }
  });

  it('merges roles across sections for a path that appears in multiple roles', () => {
    // The endpoint is a core entry AND an owned asset; assert roles merge
    // rather than emitting duplicate recommended files.
    const f = createGoldenFixture();
    try {
      const dupes = f.document.recommendedFiles.filter((r) => r.path === 'src/auth/auth-service.ts');
      expect(dupes).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });

  it('derives the artifact path from the deterministic contextId', () => {
    const f = createGoldenFixture();
    try {
      expect(f.document.contextId).toBe('login');
      expect(f.document.artifact.relativePath).toBe('.featuremap/context/login.md');
    } finally {
      f.cleanup();
    }
  });

  it('contextId is deterministic per feature and task, and changes with the task', () => {
    expect(contextIdOf('feature:login')).toBe('login');
    expect(contextIdOf('feature:login', 'fix session')).toBe(contextIdOf('feature:login', 'fix session'));
    expect(contextIdOf('feature:login', 'fix session')).not.toBe('login');
    // Two distinct tasks hash to distinct ids.
    expect(contextIdOf('feature:login', 'fix session')).not.toBe(contextIdOf('feature:login', 'add logout'));
  });

  it('task normalization trims and treats whitespace-only as no task', () => {
    const f = createGoldenFixture('  fix session  ');
    try {
      expect(f.document.task).toBe('fix session');
      const f2 = createGoldenFixture('   ');
      try {
        expect(f2.document.task).toBeUndefined();
        expect(f2.document.markdown).not.toContain('## Task');
      } finally {
        f2.cleanup();
      }
    } finally {
      f.cleanup();
    }
  });

  it('is read-only: building never mutates the graph', () => {
    const f = createGoldenFixture();
    const counts = (): Record<string, number> => {
      const { db, sqlite } = openDatabase(f.dbPath);
      try {
        return {
          features: db.select().from(schema.features).all().length,
          candidates: db.select().from(schema.featureCandidates).all().length,
          assets: db.select().from(schema.featureAssets).all().length,
          evidence: db.select().from(schema.evidence).all().length,
        };
      } finally {
        sqlite.close();
      }
    };
    const before = counts();
    buildFeatureContextDocument(f.repoRoot, GOLDEN_FEATURE_ID, { dbPath: f.dbPath });
    buildFeatureContextDocument(f.repoRoot, GOLDEN_FEATURE_ID, { dbPath: f.dbPath, task: 'refresh token' });
    expect(counts()).toEqual(before);
    f.cleanup();
  });

  it('never leaks source bodies into the DTO or markdown', () => {
    const f = createGoldenFixture();
    const marker = 'CONTRACT_NO_LEAK_7F1E';
    mkdirSync(`${f.repoRoot}/src/auth`, { recursive: true });
    writeFileSync(`${f.repoRoot}/src/auth/auth-service.ts`, `export const secret = '${marker}';\n`, 'utf8');
    try {
      const doc = buildFeatureContextDocument(f.repoRoot, GOLDEN_FEATURE_ID, { dbPath: f.dbPath });
      expect(doc.markdown).not.toContain(marker);
      expect(JSON.stringify(doc.sections)).not.toContain(marker);
    } finally {
      f.cleanup();
    }
  });

  it('produces canonical, deterministic markdown with stable headers', () => {
    const a = createGoldenFixture();
    const b = createGoldenFixture();
    try {
      expect(a.document.markdown).toBe(b.document.markdown);
      const md = a.document.markdown;
      const headers = ['# Feature Context: Login', '## Core Code', '## Dependencies', '## Tests', '## Policies', '## Change Impact', '## Recommended Files'];
      for (const h of headers) expect(md).toContain(h);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });
});

describe('Location Consistency — 1-based line contract', () => {
  it('preserves the 1-based symbol span verbatim across the document', () => {
    const f = createGoldenFixture();
    try {
      const service = allEntries(f.document.sections).find((e) => e.path === 'src/auth/auth-service.ts');
      expect(service?.symbol).toBeDefined();
      // Seeded as startLine=12 / endLine=18 (1-based); the document must
      // NOT shift to 0-based. Host adapters (VS Code) convert at the edge.
      const start = service?.symbol?.startLine;
      const end = service?.symbol?.endLine;
      expect(start).toBe(12);
      expect(end).toBe(18);
      if (start !== undefined && end !== undefined) expect(end).toBeGreaterThanOrEqual(start);
    } finally {
      f.cleanup();
    }
  });

  it('never emits 0-based or negative lines anywhere in the document', () => {
    const f = createGoldenFixture();
    try {
      for (const e of allEntries(f.document.sections)) {
        if (e.symbol?.startLine !== undefined) expect(e.symbol.startLine).toBeGreaterThanOrEqual(1);
        if (e.symbol?.endLine !== undefined) expect(e.symbol.endLine).toBeGreaterThanOrEqual(1);
      }
      for (const file of f.document.recommendedFiles) {
        if (file.location?.startLine !== undefined) expect(file.location.startLine).toBeGreaterThanOrEqual(1);
        for (const s of file.symbols ?? []) {
          if (s.startLine !== undefined) expect(s.startLine).toBeGreaterThanOrEqual(1);
        }
      }
    } finally {
      f.cleanup();
    }
  });

  it('a task-aware build keeps the same 1-based lines (task only re-ranks)', () => {
    const plain = createGoldenFixture();
    const tasked = createGoldenFixture('fix session');
    try {
      const s1 = allEntries(plain.document.sections).find((e) => e.path === 'src/auth/auth-service.ts');
      const s2 = allEntries(tasked.document.sections).find((e) => e.path === 'src/auth/auth-service.ts');
      expect(s1?.symbol?.startLine).toBe(12);
      expect(s2?.symbol?.startLine).toBe(12);
    } finally {
      plain.cleanup();
      tasked.cleanup();
    }
  });
});
