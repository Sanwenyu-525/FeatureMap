/**
 * Webhook dispatch tests — InMemoryProvider end-to-end (Phase 4 /
 * ADR-0007 §3). No network; the pull_request payload drives the flow.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { InMemoryProvider } from '../src/memory.js';
import { COMMENT_MARKER, handleWebhook, parseWebhookEvent } from '../src/webhook.js';

const tmpBases: string[] = [];

afterEach(() => {
  for (const base of tmpBases) rmSync(base, { recursive: true, force: true });
  tmpBases.length = 0;
});

async function gitShas(repo: string, ref: string): Promise<string> {
  const { stdout } = await $`git -C ${repo} rev-parse ${ref}`;
  return stdout.trim();
}

function prEvent(baseSha: string, headSha: string, prNumber = 7): string {
  return JSON.stringify({
    action: 'opened',
    installation: { id: 9 },
    repository: { owner: { login: 'acme' }, name: 'app' },
    pull_request: { number: prNumber, base: { sha: baseSha }, head: { sha: headSha } },
  });
}

/** Two-commit login repo with a seeded feature + test (success path). */
async function seedLoginRepo(): Promise<{ repo: string; dbPath: string; baseSha: string; headSha: string }> {
  const base = mkdtempSync(join(tmpdir(), 'featuremap-webhook-'));
  tmpBases.push(base);
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src/auth'), { recursive: true });
  mkdirSync(join(repo, 'tests/auth'), { recursive: true });
  const git = (...args: string[]) => $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
  await $`git -C ${repo} init -b main -q`;
  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v1';\n}\n", 'utf8');
  writeFileSync(join(repo, 'tests/auth/login.test.ts'), "import { login } from '../../src/auth/auth.js';\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'feat: login', '--quiet');
  const baseSha = await gitShas(repo, 'HEAD');
  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'fix: login', '--quiet');
  const headSha = await gitShas(repo, 'HEAD');

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
  db.insert(schema.features).values({ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9, health: { tests: 'present' } }).run();
  for (const path of ['src/auth/auth.ts', 'tests/auth/login.test.ts']) {
    db.insert(schema.featureAssets).values({ featureId: 'feature:login', assetId: assetId({ type: 'file', path }), confidence: 0.9 }).run();
  }
  sqlite.close();
  return { repo, dbPath, baseSha, headSha };
}

/** Repo whose PR deletes an accepted file → relation_broken → neutral → comment. */
async function seedDriftRepo(): Promise<{ repo: string; dbPath: string; baseSha: string; headSha: string }> {
  const base = mkdtempSync(join(tmpdir(), 'featuremap-webhook-drift-'));
  tmpBases.push(base);
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src/auth'), { recursive: true });
  const git = (...args: string[]) => $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
  await $`git -C ${repo} init -b main -q`;
  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v1';\n}\n", 'utf8');
  writeFileSync(join(repo, 'src/auth/legacy.ts'), "export function legacy() {\n  return 'old';\n}\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'feat: auth', '--quiet');
  const baseSha = await gitShas(repo, 'HEAD');
  rmSync(join(repo, 'src/auth/legacy.ts'));
  writeFileSync(join(repo, 'src/auth/auth.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
  await git('add', '-A');
  await git('commit', '-m', 'refactor: drop legacy', '--quiet');
  const headSha = await gitShas(repo, 'HEAD');

  const dbPath = join(base, 'featuremap.db');
  const { db, sqlite } = openDatabase(dbPath);
  db.insert(schema.projects).values({ id: 'p1', name: 'demo', root: repo, baseBranch: 'main' }).run();
  for (const path of ['src/auth/auth.ts', 'src/auth/legacy.ts']) {
    db.insert(schema.files).values({ id: assetId({ type: 'file', path }), projectId: 'p1', path }).run();
    db.insert(schema.assets).values({ id: assetId({ type: 'file', path }), type: 'file', path }).run();
  }
  db.insert(schema.symbols).values({
    id: 'symbol:src/auth/auth.ts:login',
    fileId: assetId({ type: 'file', path: 'src/auth/auth.ts' }),
    name: 'login',
    kind: 'function',
    startLine: 1,
    endLine: 3,
  }).run();
  db.insert(schema.features).values({ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9 }).run();
  for (const path of ['src/auth/auth.ts', 'src/auth/legacy.ts']) {
    db.insert(schema.featureAssets).values({ featureId: 'feature:login', assetId: assetId({ type: 'file', path }), confidence: 0.9 }).run();
  }
  db.insert(schema.featureCandidates).values({
    id: 'c_legacy',
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/auth/legacy.ts',
    relation: 'owns',
    status: 'accepted',
  }).run();
  sqlite.close();
  return { repo, dbPath, baseSha, headSha };
}

describe('handleWebhook', () => {
  it('ignores non-pull_request payloads', async () => {
    const result = await handleWebhook('{"action":"ping","zen":"hi"}', {
      repoRoot: process.cwd(),
      provider: new InMemoryProvider(),
    });
    expect(result.handled).toBe(false);
  });

  it('ignores malformed JSON', async () => {
    const result = await handleWebhook('not-json', {
      repoRoot: process.cwd(),
      provider: new InMemoryProvider(),
    });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('invalid JSON');
  });

  it('posts a success check and no comment for a clean change', async () => {
    const { repo, dbPath, baseSha, headSha } = await seedLoginRepo();
    const provider = new InMemoryProvider();

    const result = await handleWebhook(prEvent(baseSha, headSha), {
      repoRoot: repo,
      provider,
      scan: false,
      dbPath,
    });

    expect(result.handled).toBe(true);
    expect(result.check?.ok).toBe(true);
    expect(result.check?.conclusion).toBe('success');
    expect(provider.runs).toHaveLength(1);
    expect(provider.comments).toHaveLength(0);
    expect(result.comment).toBeUndefined();
  });

  it('creates one persistent review comment on a broken mapping, then updates it', async () => {
    const { repo, dbPath, baseSha, headSha } = await seedDriftRepo();
    const provider = new InMemoryProvider();

    const first = await handleWebhook(prEvent(baseSha, headSha), { repoRoot: repo, provider, scan: false, dbPath });
    expect(first.check?.conclusion).toBe('neutral');
    expect(first.comment?.updated).toBe(false);
    expect(provider.comments).toHaveLength(1);
    expect(provider.comments[0]!.body).toContain(COMMENT_MARKER);

    const second = await handleWebhook(prEvent(baseSha, headSha), { repoRoot: repo, provider, scan: false, dbPath });
    expect(second.comment?.updated).toBe(true);
    expect(provider.comments).toHaveLength(1);
  });
});

describe('parseWebhookEvent', () => {
  it('extracts base/head shas and the PR number', () => {
    const event = parseWebhookEvent(prEvent('aa', 'bb', 42));
    expect(event.pull_request?.number).toBe(42);
    expect(event.pull_request?.base?.sha).toBe('aa');
    expect(event.pull_request?.head?.sha).toBe('bb');
  });
});
