/**
 * `featuremap pr` report tests — Phase 4, v0.4.0.
 *
 * A PR is a commit range; the report layers risk band, test coverage
 * and mapping drift over the impact traversal. Every assertion is
 * deterministic (no LLM, AGENTS.md §3.2).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { buildPrReport } from '../src/pr-report.js';

const tmpBases: string[] = [];

afterEach(() => {
  for (const base of tmpBases) rmSync(base, { recursive: true, force: true });
  tmpBases.length = 0;
});

/** Create a scripted git repo and return its root. */
async function initRepo(): Promise<string> {
  const base = mkdtempSync(join(tmpdir(), 'featuremap-pr-'));
  tmpBases.push(base);
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src/auth'), { recursive: true });
  mkdirSync(join(repo, 'src/session'), { recursive: true });
  mkdirSync(join(repo, 'src/shared'), { recursive: true });
  mkdirSync(join(repo, 'src/token'), { recursive: true });
  mkdirSync(join(repo, 'tests/auth'), { recursive: true });
  mkdirSync(join(repo, 'tests/session'), { recursive: true });
  await $`git -C ${repo} init -b main -q`;
  return repo;
}

const git = (repo: string, ...args: string[]) =>
  $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;

async function commit(repo: string, message: string): Promise<void> {
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', message, '--quiet');
}

/** Seed the store the way a scan would (files, symbols, assets, features, candidates). */
function seedStore(dbPath: string, repo: string): void {
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects).values({ id: 'p1', name: 'demo', root: repo, baseBranch: 'main' }).run();

  const filePaths = [
    'src/auth/auth.ts',
    'src/session/session.ts',
    'src/shared/logger.ts',
    'src/token/token.ts',
    'tests/auth/login.test.ts',
    'tests/session/session.test.ts',
  ];
  // Files and assets share the file-hash id; test files are stored with
  // type 'test' so the test → feature association resolves (impact.ts
  // resolves feature tests via asset.type === 'test').
  for (const path of filePaths) {
    db.insert(schema.files).values({ id: assetId({ type: 'file', path }), projectId: 'p1', path }).run();
  }
  for (const path of ['src/auth/auth.ts', 'src/session/session.ts', 'src/shared/logger.ts', 'src/token/token.ts']) {
    db.insert(schema.assets).values({ id: assetId({ type: 'file', path }), type: 'file', path }).run();
  }
  for (const path of ['tests/auth/login.test.ts', 'tests/session/session.test.ts']) {
    db.insert(schema.assets).values({ id: assetId({ type: 'file', path }), type: 'test', path }).run();
  }

  const symbol = (path: string, name: string, startLine: number, endLine: number) =>
    db.insert(schema.symbols).values({
      id: `symbol:${path}:${name}`,
      fileId: assetId({ type: 'file', path }),
      name,
      kind: 'function',
      startLine,
      endLine,
    }).run();
  symbol('src/auth/auth.ts', 'login', 1, 3);
  symbol('src/session/session.ts', 'createSession', 2, 4);
  symbol('src/shared/logger.ts', 'logger', 1, 1);
  symbol('src/token/token.ts', 'createToken', 2, 4);

  const feature = (id: string, name: string, pattern: string) =>
    db.insert(schema.features).values({
      id,
      name,
      pattern,
      confidence: 0.9,
      health: { implementation: 'complete', tests: 'present', documentation: 'missing' },
    }).run();
  feature('feature:login', 'Login', 'Authentication');
  feature('feature:session', 'Session', 'Workflow');
  feature('feature:token', 'Token', 'Event');

  const own = (featureId: string, path: string, confidence = 0.9) =>
    db.insert(schema.featureAssets)
      .values({ featureId, assetId: assetId({ type: 'file', path }), confidence })
      .run();
  own('feature:login', 'src/auth/auth.ts');
  own('feature:login', 'tests/auth/login.test.ts');
  own('feature:session', 'src/session/session.ts');
  own('feature:session', 'tests/session/session.test.ts');
  own('feature:token', 'src/token/token.ts');

  const candidate = (id: string, featureId: string, targetType: 'file' | 'symbol', targetId: string, status: 'accepted' | 'declared') =>
    db.insert(schema.featureCandidates)
      .values({
        id,
        featureId,
        targetType,
        targetId,
        relation: 'owns',
        status,
      })
      .run();
  candidate('c_login_anchor', 'feature:login', 'file', 'src/auth/auth.ts', 'declared');
  candidate('c_login_symbol', 'feature:login', 'symbol', 'src/auth/auth.ts:login', 'accepted');
  candidate('c_session_anchor', 'feature:session', 'file', 'src/session/session.ts', 'declared');
  candidate('c_session_symbol', 'feature:session', 'symbol', 'src/session/session.ts:createSession', 'accepted');
  candidate('c_token_anchor', 'feature:token', 'file', 'src/token/token.ts', 'declared');

  // Reverse-import evidence: auth & session & token all depend on the
  // shared logger (fan-in 3 → shared infrastructure, ADR-0004 §4), and
  // session depends on auth (1 hop → MEDIUM).
  const imports = (id: string, source: string, target: string) =>
    db.insert(schema.evidence).values({
      id,
      sourceType: 'file',
      sourceId: source,
      relationType: 'IMPORTS',
      targetType: 'file',
      targetId: target,
      confidence: 1.0,
      analyzerId: 'typescript',
      origin: 'deterministic',
    }).run();
  imports('e_imp_auth_logger', 'src/auth/auth.ts', 'src/shared/logger.ts');
  imports('e_imp_session_logger', 'src/session/session.ts', 'src/shared/logger.ts');
  imports('e_imp_token_logger', 'src/token/token.ts', 'src/shared/logger.ts');
  imports('e_imp_session_auth', 'src/session/session.ts', 'src/auth/auth.ts');

  sqlite.close();
}

describe('buildPrReport — acceptance scenario (v0.4.0)', () => {
  it('reports affected features, risk band, test coverage and no false drift', async () => {
    const repo = await initRepo();
    writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v1';\n}\n", 'utf8');
    writeFileSync(
      join(repo, 'src/session/session.ts'),
      "import { login } from '../auth/auth.js';\nexport function createSession() {\n  return 's1';\n}\n",
      'utf8',
    );
    writeFileSync(join(repo, 'src/shared/logger.ts'), 'export const logger = { info: () => {} };\n', 'utf8');
    writeFileSync(join(repo, 'src/token/token.ts'), "import { logger } from '../shared/logger.js';\nexport function createToken() {\n  return 't1';\n}\n", 'utf8');
    writeFileSync(join(repo, 'tests/auth/login.test.ts'), "import { login } from '../../src/auth/auth.js';\n", 'utf8');
    writeFileSync(join(repo, 'tests/session/session.test.ts'), "import { createSession } from '../../src/session/session.js';\n", 'utf8');
    await commit(repo, 'feat: add login/session/token');

    // The PR: modify AuthService.login, logger and the login test;
    // session.test.ts stays untouched.
    writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
    writeFileSync(join(repo, 'src/shared/logger.ts'), 'export const logger = { info: (m: string) => console.log(m) };\n', 'utf8');
    writeFileSync(join(repo, 'tests/auth/login.test.ts'), "import { login } from '../../src/auth/auth.js';\n\nit('ok', () => {});\n", 'utf8');
    await commit(repo, 'fix: change login behavior');

    const dbPath = join(mkdtempSync(join(tmpdir(), 'featuremap-pr-db-')), 'featuremap.db');
    tmpBases.push(dbPath.slice(0, dbPath.lastIndexOf('featuremap.db')));
    seedStore(dbPath, repo);

    const report = await buildPrReport(repo, { range: 'HEAD~1..HEAD', dbPath });

    // Impact: login HIGH (symbol-level), session MEDIUM (1 hop via import).
    const login = report.affectedFeatures.find((f) => f.featureId === 'feature:login');
    expect(login?.severity).toBe('HIGH');
    const session = report.affectedFeatures.find((f) => f.featureId === 'feature:session');
    expect(session?.severity).toBe('MEDIUM');
    // Logger has fan-in 3 and no owner → shared infrastructure, never impact.
    expect(report.sharedInfrastructure.some((s) => s.path === 'src/shared/logger.ts')).toBe(true);
    expect(report.affectedFeatures.some((f) => f.featureId === 'feature:token')).toBe(false);

    // Risk band: direct core (+1) + shared dep (+1) + session tests unchanged (+1) = 3 → MEDIUM.
    expect(report.risk.band).toBe('MEDIUM');
    expect(report.risk.contributions.some((c) => c.reason.includes('相关测试未变更'))).toBe(true);

    // Test coverage: login test changed (✓), session test not (⚠).
    const loginTest = report.testCoverage.find((t) => t.path === 'tests/auth/login.test.ts');
    expect(loginTest?.changed).toBe(true);
    const sessionTest = report.testCoverage.find((t) => t.path === 'tests/session/session.test.ts');
    expect(sessionTest?.changed).toBe(false);

    // No deletion → no drift; modified accepted symbols are not re-suggested.
    expect(report.mappingDrift).toEqual([]);
  });
});

describe('buildPrReport — mapping drift (v0.4.0)', () => {
  it('flags deleted accepted files as broken relations and new symbols as candidates', async () => {
    const repo = await initRepo();
    writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v1';\n}\n", 'utf8');
    writeFileSync(join(repo, 'src/auth/legacy.ts'), "export function legacyAuth() {\n  return 'old';\n}\n", 'utf8');
    writeFileSync(join(repo, 'src/shared/logger.ts'), 'export const logger = { info: () => {} };\n', 'utf8');
    await commit(repo, 'feat: add login');

    // PR: delete the accepted legacy file, add a new unaccepted symbol.
    writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v2';\n}\nexport function refresh() {\n  return 'r';\n}\n", 'utf8');
    rmSync(join(repo, 'src/auth/legacy.ts'));
    await commit(repo, 'refactor: drop legacy auth, add refresh');

    const dbPath = join(mkdtempSync(join(tmpdir(), 'featuremap-pr-drift-db-')), 'featuremap.db');
    tmpBases.push(dbPath.slice(0, dbPath.lastIndexOf('featuremap.db')));
    const { db, sqlite } = openDatabase(dbPath);
    db.insert(schema.projects).values({ id: 'p2', name: 'drift', root: repo, baseBranch: 'main' }).run();
    for (const path of ['src/auth/auth.ts', 'src/auth/legacy.ts', 'src/shared/logger.ts']) {
      db.insert(schema.files).values({ id: assetId({ type: 'file', path }), projectId: 'p2', path }).run();
      db.insert(schema.assets).values({ id: assetId({ type: 'file', path }), type: 'file', path }).run();
    }
    for (const [name, start, end] of [
      ['login', 1, 3],
      ['refresh', 4, 6],
    ] as const) {
      db.insert(schema.symbols).values({
        id: `symbol:src/auth/auth.ts:${name}`,
        fileId: assetId({ type: 'file', path: 'src/auth/auth.ts' }),
        name,
        kind: 'function',
        startLine: start,
        endLine: end,
      }).run();
    }
    db.insert(schema.features)
      .values({ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9, health: { tests: 'present' } })
      .run();
    for (const path of ['src/auth/auth.ts', 'src/auth/legacy.ts']) {
      db.insert(schema.featureAssets).values({ featureId: 'feature:login', assetId: assetId({ type: 'file', path }), confidence: 0.9 }).run();
    }
    db.insert(schema.featureCandidates)
      .values({ id: 'c_anchor', featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/auth.ts', relation: 'owns', status: 'declared' })
      .run();
    db.insert(schema.featureCandidates)
      .values({ id: 'c_legacy', featureId: 'feature:login', targetType: 'file', targetId: 'src/auth/legacy.ts', relation: 'owns', status: 'accepted' })
      .run();
    db.insert(schema.featureCandidates)
      .values({ id: 'c_login_symbol', featureId: 'feature:login', targetType: 'symbol', targetId: 'src/auth/auth.ts:login', relation: 'owns', status: 'accepted' })
      .run();
    sqlite.close();

    const report = await buildPrReport(repo, { range: 'HEAD~1..HEAD', dbPath });

    const broken = report.mappingDrift.filter((d) => d.kind === 'relation_broken');
    expect(broken.map((d) => d.targetId)).toContain('src/auth/legacy.ts');
    expect(broken.some((d) => d.targetId === 'src/auth/auth.ts')).toBe(false);

    const candidates = report.mappingDrift.filter((d) => d.kind === 'new_candidate');
    expect(candidates.some((d) => d.targetId.includes(':refresh') && d.featureId === 'feature:login')).toBe(true);
    // The modified-but-accepted login symbol is not re-suggested.
    expect(candidates.some((d) => d.targetId.includes(':login'))).toBe(false);
  });
});
