/**
 * Stage 0 (v0.7.0) — Golden contract fixture (docs/DEVELOPMENT_PLAN.md
 * Milestone 25 §Stage 0/Stage 3).
 *
 * A deterministic, committed reference for `FeatureContextDocument`:
 * the login feature is seeded as DB rows (a projection of the graph),
 * then `buildFeatureContextDocument` turns it into the canonical
 * document. All surfaces — CLI / MCP / IDE / HTTP — must reproduce this
 * same document for the same feature, so Stage 3 drives every surface
 * against the invariants exported here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type FeatureMapDatabase } from '@featuremap/db';
import {
  buildFeatureContextDocument,
  type ContextDocumentSections,
  type FeatureContextDocument,
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
  seedSymbol,
} from './seed.js';

export const GOLDEN_FEATURE_ID = 'feature:login';
export const GOLDEN_FEATURE_NAME = 'Login';

/** Stable section keys — the cross-surface contract (never re-ordered). */
export const CONTRACT_SECTION_KEYS = ['core', 'dependencies', 'tests', 'policies', 'changes', 'other'] as const;

/**
 * Deterministic login feature. Rejected relations, shared infra and
 * dependents are intentionally controlled so the empty-section and
 * exclusion invariants are observable (changes/other stay empty unless
 * a test seeds commits / imports).
 */
export function seedContractLogin(db: FeatureMapDatabase): void {
  seedFeature(db, GOLDEN_FEATURE_ID, GOLDEN_FEATURE_NAME, 'Authentication', '用户登录认证');
  const anchor = seedFile(db, 'src/auth/login-handler.ts');
  const service = seedFile(db, 'src/auth/auth-service.ts');
  const repo = seedFile(db, 'src/auth/user-repository.ts');
  seedFile(db, 'src/shared/logger.ts'); // dependency via IMPORTS, never core
  const testFile = seedFile(db, 'src/auth/login.test.ts', { type: 'test' });
  const endpoint = seedFile(db, 'src/api/login.ts', { type: 'endpoint', name: 'login (POST /api/login)' });

  for (const [asset, confidence] of [
    [anchor, 1],
    [service, 0.95],
    [repo, 0.85],
    [testFile, 0.95],
    [endpoint, 1],
  ] as const) {
    seedFeatureAsset(db, GOLDEN_FEATURE_ID, asset, confidence);
  }

  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'file',
    targetId: 'src/auth/login-handler.ts',
    relation: 'owns',
    status: 'declared',
    score: 1,
    distance: 0,
    fanIn: 1,
  });
  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'file',
    targetId: 'src/auth/auth-service.ts',
    relation: 'owns',
    status: 'accepted',
    score: 0.92,
    distance: 1,
    fanIn: 2,
  });
  // Symbol-level candidate — the 1-based line span (12-18) must survive
  // into the document untouched (Location Consistency, Stage 0).
  seedSymbol(db, 'src/auth/auth-service.ts', 'login', 'function', 12, 18);
  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'symbol',
    targetId: 'src/auth/auth-service.ts:login',
    relation: 'owns',
    status: 'accepted',
    score: 0.95,
    distance: 1,
    fanIn: 2,
  });
  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'file',
    targetId: 'src/auth/user-repository.ts',
    relation: 'owns',
    status: 'suggested',
    score: 0.8,
    distance: 2,
    fanIn: 2,
  });
  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'file',
    targetId: 'src/shared/logger.ts',
    relation: 'DEPENDS_ON',
    status: 'suggested',
    score: 0.55,
    distance: 1,
    fanIn: 3,
  });
  // Rejected relation must never enter a context (contract, not luck).
  seedCandidate(db, {
    featureId: GOLDEN_FEATURE_ID,
    targetType: 'file',
    targetId: 'src/shared/http-client.ts',
    relation: 'DEPENDS_ON',
    status: 'rejected',
    score: 0.6,
  });

  seedBelongsToEvidence(db, GOLDEN_FEATURE_ID, 'src/auth/login-handler.ts', 1, 'typescript', 'deterministic');
  seedBelongsToEvidence(db, GOLDEN_FEATURE_ID, 'src/auth/auth-service.ts', 0.95);
  seedBelongsToEvidence(db, GOLDEN_FEATURE_ID, 'src/auth/login.test.ts', 0.95);
  seedBelongsToEvidence(db, GOLDEN_FEATURE_ID, 'src/api/login.ts', 1, 'express', 'deterministic');
  seedImports(db, 'src/auth/auth-service.ts', 'src/shared/logger.ts');
  seedImports(db, 'src/auth/login-handler.ts', 'src/auth/auth-service.ts');
  seedInstruction(db, GOLDEN_FEATURE_ID, '登录与鉴权逻辑必须通过 auth-service 处理', {
    level: 'required',
    scope: 'src/auth',
    documentPath: 'docs/auth-policy.md',
  });
}

export interface GoldenFixture {
  repoRoot: string;
  dbPath: string;
  document: FeatureContextDocument;
  cleanup(): void;
}

/** Seed the golden fixture on disk and build its canonical document. */
export function createGoldenFixture(task?: string): GoldenFixture {
  const dir = mkdtempSync(join(tmpdir(), 'fm-contract-'));
  const repoRoot = join(dir, 'repo');
  const dbPath = join(dir, 'featuremap.db');
  const { db, sqlite } = openDatabase(dbPath);
  seedProject(db);
  seedContractLogin(db);
  sqlite.close();
  const document = buildFeatureContextDocument(repoRoot, GOLDEN_FEATURE_ID, { dbPath, task });
  return { repoRoot, dbPath, document, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** All document section entries, in canonical order. */
export function allEntries(sections: ContextDocumentSections) {
  return [
    ...sections.core,
    ...sections.dependencies,
    ...sections.tests,
    ...sections.policies,
    ...sections.changes,
    ...sections.other,
  ];
}
