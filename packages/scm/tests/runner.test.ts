/**
 * Runner tests — end-to-end with InMemoryProvider and a seeded store
 * (Phase 4 / ADR-0006 §4). No network, no credentials.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { DEFAULT_CHECK_NAME } from '../src/check-renderer.js';
import { InMemoryProvider } from '../src/memory.js';
import { runGitHubCheck } from '../src/runner.js';

const tmpBases: string[] = [];

afterEach(() => {
  for (const base of tmpBases) rmSync(base, { recursive: true, force: true });
  tmpBases.length = 0;
});

/** Scripted repo with a two-commit login history and a seeded store. */
async function seedRepo(): Promise<{ repo: string; dbPath: string; headSha: string }> {
  const base = mkdtempSync(join(tmpdir(), 'featuremap-scm-'));
  tmpBases.push(base);
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src/auth'), { recursive: true });
  mkdirSync(join(repo, 'tests/auth'), { recursive: true });
  const git = (...args: string[]) =>
    $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
  await $`git -C ${repo} init -b main -q`;

  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v1';\n}\n", 'utf8');
  writeFileSync(join(repo, 'tests/auth/login.test.ts'), "import { login } from '../../src/auth/auth.js';\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'feat: add login', '--quiet');

  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'fix: change login', '--quiet');

  const { stdout } = await $`git -C ${repo} rev-parse HEAD`;
  const headSha = stdout.trim();

  const dbPath = join(base, 'featuremap.db');
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects).values({ id: 'p1', name: 'demo', root: repo, baseBranch: 'main' }).run();
  for (const path of ['src/auth/auth.ts', 'tests/auth/login.test.ts']) {
    db.insert(schema.files).values({ id: assetId({ type: 'file', path }), projectId: 'p1', path }).run();
  }
  db.insert(schema.assets).values({ id: assetId({ type: 'file', path: 'src/auth/auth.ts' }), type: 'file', path: 'src/auth/auth.ts' }).run();
  db.insert(schema.assets).values({ id: assetId({ type: 'file', path: 'tests/auth/login.test.ts' }), type: 'test', path: 'tests/auth/login.test.ts' }).run();
  db.insert(schema.symbols).values({
    id: 'symbol:src/auth/auth.ts:login',
    fileId: assetId({ type: 'file', path: 'src/auth/auth.ts' }),
    name: 'login',
    kind: 'function',
    startLine: 1,
    endLine: 3,
  }).run();
  db.insert(schema.features).values({
    id: 'feature:login',
    name: 'Login',
    pattern: 'Authentication',
    confidence: 0.9,
    health: { tests: 'present' },
  }).run();
  for (const path of ['src/auth/auth.ts', 'tests/auth/login.test.ts']) {
    db.insert(schema.featureAssets).values({ featureId: 'feature:login', assetId: assetId({ type: 'file', path }), confidence: 0.9 }).run();
  }
  sqlite.close();
  return { repo, dbPath, headSha };
}

describe('runGitHubCheck', () => {
  it('creates a success check for a clean change', async () => {
    const { repo, dbPath, headSha } = await seedRepo();
    const provider = new InMemoryProvider();

    const result = await runGitHubCheck(repo, {
      provider,
      owner: 'acme',
      repo: 'app',
      headSha,
      range: 'HEAD~1..HEAD',
      scan: false,
      dbPath,
    });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
    expect(provider.runs).toHaveLength(1);
    const run = provider.runs[0]!;
    expect(run.name).toBe(DEFAULT_CHECK_NAME);
    expect(run.headSha).toBe(headSha);
    expect(run.conclusion).toBe('success');
    expect(run.output.summary).toContain('Affected features: 1');
  });

  it('updates the same run in place on re-run (persistent check)', async () => {
    const { repo, dbPath, headSha } = await seedRepo();
    const provider = new InMemoryProvider();

    const first = await runGitHubCheck(repo, { provider, owner: 'acme', repo: 'app', headSha, range: 'HEAD~1..HEAD', scan: false, dbPath });
    const second = await runGitHubCheck(repo, { provider, owner: 'acme', repo: 'app', headSha, range: 'HEAD~1..HEAD', scan: false, dbPath });

    expect(first.updated).toBe(false);
    expect(second.updated).toBe(true);
    expect(provider.runs).toHaveLength(1);
    expect(provider.calls).toContain(`create:${DEFAULT_CHECK_NAME}`);
    expect(provider.calls).toContain(`update:1`);
  });

  it('reports an analysis failure as a failing check instead of swallowing it', async () => {
    const { repo, dbPath, headSha } = await seedRepo();
    const provider = new InMemoryProvider();

    // `nope` is not a valid ref → git diff fails → analysis failure.
    const result = await runGitHubCheck(repo, {
      provider,
      owner: 'acme',
      repo: 'app',
      headSha,
      range: 'nope..HEAD',
      scan: false,
      dbPath,
    });

    expect(result.ok).toBe(false);
    expect(provider.runs[0]!.conclusion).toBe('failure');
    expect(provider.runs[0]!.output.summary).toContain('Analysis failed');
  });
});
