/**
 * v0.6.5 document API tests (plan §74–§100).
 *
 * buildFeatureContextDocument is the canonical presentation projection:
 * read-only invariant, task-only rerank, no source bodies, stable
 * contextId/artifact, Recommended Files dedupe + order, canonical
 * Markdown headers and CLI parity.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase, schema } from '@featuremap/db';
import { assembleContext } from '../src/context-builder.js';
import {
  buildFeatureContextDocument,
  contextIdOf,
  deriveRecommendedFiles,
  mapDocumentSections,
  normalizeTask,
  renderFeatureContextMarkdown,
} from '../src/context-document.js';
import {
  seedProject,
  seedFile,
  seedFeature,
  seedFeatureAsset,
  seedCandidate,
  seedBelongsToEvidence,
  seedImports,
  seedInstruction,
} from './seed.js';

function seedLogin(db: Parameters<typeof seedProject>[0]): void {
  seedFeature(db, 'feature:login', 'Login', 'Authentication', '用户登录认证');
  const anchor = seedFile(db, 'src/auth/login-handler.ts');
  const service = seedFile(db, 'src/auth/auth-service.ts');
  const repo = seedFile(db, 'src/auth/user-repository.ts');
  seedFile(db, 'src/shared/logger.ts');
  const testFile = seedFile(db, 'src/auth/login.test.ts', { type: 'test' });
  seedFeatureAsset(db, 'feature:login', anchor, 1);
  seedFeatureAsset(db, 'feature:login', service, 0.95);
  seedFeatureAsset(db, 'feature:login', repo, 0.85);
  seedFeatureAsset(db, 'feature:login', testFile, 0.95);
  seedCandidate(db, { featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/login-handler.ts', relation: 'owns', status: 'declared', score: 1, distance: 0, fanIn: 1 });
  seedBelongsToEvidence(db, 'feature:login', 'src/auth/auth-service.ts', 1);
  seedImports(db, 'src/auth/auth-service.ts', 'src/shared/logger.ts');
  seedImports(db, 'src/auth/login-handler.ts', 'src/auth/auth-service.ts');
  seedInstruction(db, 'feature:login', '登录与鉴权逻辑必须通过 auth-service 处理', { level: 'required', documentPath: 'docs/auth-policy.md' });
}

let dir: string;
let dbPath: string;
let repo: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fm-context-doc-'));
  repo = join(dir, 'repo');
  dbPath = join(dir, 'featuremap.db');
  const { db, sqlite } = openDatabase(dbPath);
  seedProject(db);
  seedLogin(db);
  sqlite.close();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('normalizeTask & contextId (plan §81)', () => {
  it('normalizes whitespace and yields stable ids', () => {
    expect(normalizeTask('  ')).toBeUndefined();
    expect(normalizeTask('Fix login')).toBe('Fix login');
    expect(contextIdOf('feature:login')).toBe('login');
    expect(contextIdOf('feature:login', '  Fix login ')).toBe(contextIdOf('feature:login', 'Fix login'));
    expect(contextIdOf('feature:login', 'Fix login')).not.toBe('login');
  });
});

describe('buildFeatureContextDocument (plan §74–§82)', () => {
  it('produces canonical sections, recommended files, artifact and markdown', () => {
    const doc = buildFeatureContextDocument(repo, 'login', { dbPath });
    expect(doc.feature.name).toBe('Login');
    expect(doc.contextId).toBe('login');
    expect(doc.artifact.relativePath).toBe('.featuremap/context/login.md');
    expect(doc.sections.core.length).toBeGreaterThan(0);
    expect(doc.sections.policies.length).toBeGreaterThan(0);
    expect(doc.recommendedFiles.length).toBeGreaterThan(0);
    expect(doc.markdown).toContain('# Feature Context: Login');
    expect(doc.markdown).toContain('## Core Code');
    expect(doc.markdown).toContain('## Dependencies');
    expect(doc.markdown).toContain('## Tests');
    expect(doc.markdown).toContain('## Policies');
    expect(doc.markdown).toContain('## Change Impact');
    expect(doc.markdown).toContain('## Recommended Files');
  });

  it('is read-only: no DB row changes before/after (plan §74)', () => {
    const counts = (): Record<string, number> => {
      const { db, sqlite } = openDatabase(dbPath);
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
    buildFeatureContextDocument(repo, 'login', { dbPath });
    buildFeatureContextDocument(repo, 'login', { dbPath, task: 'Add refresh token rotation' });
    const after = counts();
    expect(after).toEqual(before);
  });

  it('never leaks source bodies into DTO or markdown (plan §93)', () => {
    const marker = 'FEATUREMAP_DO_NOT_LEAK_SOURCE_4F92E';
    mkdirSync(join(repo, 'src/auth'), { recursive: true });
    writeFileSync(join(repo, 'src/auth/auth-service.ts'), `export const secret = '${marker}';\n`, 'utf8');
    const doc = buildFeatureContextDocument(repo, 'login', { dbPath });
    expect(doc.markdown).not.toContain(marker);
    expect(JSON.stringify(doc.sections)).not.toContain(marker);
  });

  it('task only changes ranking and markdown Task section, never DB (plan §75–§76)', () => {
    const plain = buildFeatureContextDocument(repo, 'login', { dbPath });
    const tasked = buildFeatureContextDocument(repo, 'login', { dbPath, task: 'refresh token' });
    expect(tasked.task).toBe('refresh token');
    expect(tasked.markdown).toContain('## Task');
    expect(plain.markdown).not.toContain('## Task');
    expect(plain.recommendedFiles.map((f) => f.path)).toEqual(tasked.recommendedFiles.map((f) => f.path));
  });

  it('recommended files dedupe paths and merge roles in ranked order (plan §94–§95)', () => {
    const { db, sqlite } = openMemoryDatabase();
    try {
      seedProject(db);
      seedLogin(db);
      const context = assembleContext(db, 'login', { budget: 8000 });
      const sections = mapDocumentSections(context);
      const files = deriveRecommendedFiles(sections, context.feature.name);
      const paths = files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length); // dedupe
      const service = files.find((f) => f.path === 'src/auth/auth-service.ts');
      expect(service?.roles).toContain('core');
      // Order = first appearance in ranked sections, not alphabetical.
      const sorted = [...paths].sort();
      expect(paths).not.toEqual(sorted); // preserves ranking, not lexicographic
      expect(files.every((f) => f.reason.length > 0)).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('renderFeatureContextMarkdown is stable and canonical', () => {
    const { db, sqlite } = openMemoryDatabase();
    try {
      seedProject(db);
      seedLogin(db);
      const context = assembleContext(db, 'login', { budget: 8000 });
      const sections = mapDocumentSections(context);
      const doc = {
        formatVersion: 1 as const,
        contextId: 'login',
        feature: { id: 'feature:login', name: 'Login' },
        sections,
        recommendedFiles: deriveRecommendedFiles(sections, 'Login'),
        artifact: { relativePath: '.featuremap/context/login.md' },
        markdown: '',
      };
      const md = renderFeatureContextMarkdown({ ...doc, markdown: '' });
      const again = renderFeatureContextMarkdown({ ...doc, markdown: '' });
      expect(md).toBe(again);
      expect(md).toContain('# Feature Context: Login');
    } finally {
      sqlite.close();
    }
  });
});
