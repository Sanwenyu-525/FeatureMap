/**
 * Git change model tests — Milestone 10 (docs/DEVELOPMENT_PLAN.md),
 * ADR-0004 §1–§2.
 *
 * Pinned behavior:
 * - parseChangeSources resolves no-arg / HEAD / from..to
 * - parseDiffHunks extracts exact new-side changed lines (--unified=0)
 * - inspectCommit on a scripted commit sequence produces deterministic
 *   changed files and changed symbols; non-HEAD commits are labeled
 *   approximate; root commits inspect correctly
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase, schema } from '@featuremap/db';
import { parseChangeSources } from '../src/git/change-source.js';
import { parseDiffHunks, hunksForCommit } from '../src/git/hunks.js';
import { inspectCommit } from '../src/git/inspect.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-git-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('parseChangeSources (ADR-0004 §1)', () => {
  it('no argument resolves to working-tree + branch-diff (Milestone 4 default)', () => {
    expect(parseChangeSources()).toEqual([{ kind: 'working-tree' }, { kind: 'branch-diff' }]);
    expect(parseChangeSources('   ')).toEqual([{ kind: 'working-tree' }, { kind: 'branch-diff' }]);
  });

  it('HEAD resolves to the single most recent commit', () => {
    expect(parseChangeSources('HEAD')).toEqual([{ kind: 'commit-range', from: 'HEAD~1', to: 'HEAD' }]);
  });

  it('parses explicit from..to ranges', () => {
    expect(parseChangeSources('main..HEAD')).toEqual([{ kind: 'commit-range', from: 'main', to: 'HEAD' }]);
    expect(parseChangeSources('HEAD~3..HEAD')).toEqual([{ kind: 'commit-range', from: 'HEAD~3', to: 'HEAD' }]);
  });

  it('any other commit-ish means that one commit', () => {
    expect(parseChangeSources('abc123')).toEqual([{ kind: 'commit-range', from: 'abc123~1', to: 'abc123' }]);
  });
});

describe('parseDiffHunks (--unified=0)', () => {
  const sample = [
    'diff --git a/src/auth.ts b/src/auth.ts',
    'index 1111111..2222222 100644',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -1,2 +1,3 @@',
    '-  return \'v1\';',
    '+  return \'v2\';',
    '+  console.log(\'trace\');',
    'diff --git a/src/logger.ts b/src/logger.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/logger.ts',
    '@@ -0,0 +1,1 @@',
    '+export function log() {}',
    '',
  ].join('\n');

  it('extracts new-side changed lines per file', () => {
    const hunks = parseDiffHunks(sample);
    expect(hunks).toHaveLength(2);
    const auth = hunks.find((h) => h.path === 'src/auth.ts');
    expect(auth?.changeType).toBe('modified');
    expect(auth?.newLines).toEqual([1, 2]);
    const logger = hunks.find((h) => h.path === 'src/logger.ts');
    expect(logger?.changeType).toBe('added');
    expect(logger?.newLines).toEqual([1]);
  });

  it('treats pure deletions as no new-side lines', () => {
    const raw = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-export const GONE = true;',
    ].join('\n');
    const [hunk] = parseDiffHunks(raw) as [{ path: string; changeType: string; newLines: number[] }];
    expect(hunk.changeType).toBe('deleted');
    expect(hunk.newLines).toEqual([]);
  });

  it('resets new-side counting across multiple hunks in one file', () => {
    const raw = [
      'diff --git a/src/multi.ts b/src/multi.ts',
      '--- a/src/multi.ts',
      '+++ b/src/multi.ts',
      '@@ -5,1 +5,1 @@',
      '-  a();',
      '+  b();',
      '@@ -9,1 +9,1 @@',
      '-  c();',
      '+  d();',
    ].join('\n');
    const [hunk] = parseDiffHunks(raw) as [{ newLines: number[] }];
    expect(hunk.newLines).toEqual([5, 9]);
  });
});

describe('inspectCommit integration (scripted commit sequence)', () => {
  // Real git subprocesses under full-suite parallelism (27 files) can
  // exceed vitest's default 5000ms timeout on Windows; the integration
  // itself is fast in isolation (~1s).
  it('reports deterministic changed symbols; non-HEAD commits are approximate', async () => {
    const repo = tempDir();
    await $`git -C ${repo} init -b main -q`;
    // Deterministic author to keep SHAs and metadata stable enough for assertions.
    const git = (...args: string[]) => $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;

    // src/auth.ts — two symbols at known line spans:
    //   1: export function login() {
    //   2:   return 'v1';
    //   3: }
    //   4:
    //   5: export const TAG = 'first';
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src/auth.ts'), "export function login() {\n  return 'v1';\n}\n\nexport const TAG = 'first';\n", 'utf8');
    await git('add', 'src/auth.ts');
    await git('commit', '-m', 'feat: add login helper', '--quiet');
    const { stdout: sha1Out } = await git('rev-parse', 'HEAD');
    const sha1 = sha1Out.trim();

    // Second commit: touch TAG (line 5) and an unmapped line (line 7).
    writeFileSync(
      join(repo, 'src/auth.ts'),
      "export function login() {\n  return 'v1';\n}\n\nexport const TAG = 'second';\n\n// helper updated\n",
      'utf8',
    );
    await git('add', 'src/auth.ts');
    await git('commit', '-m', 'fix: bump tag', '--quiet');
    const { stdout: sha2Out } = await git('rev-parse', 'HEAD');
    const sha2 = sha2Out.trim();

    // Seed the store like a scan would (project / file / symbols / commit rows).
    const dbPath = join(repo, '.featuremap', 'test.db');
    const { db, sqlite } = openDatabase(dbPath);
    db.insert(schema.projects).values({ id: 'p_test', name: 'git-test', root: repo, baseBranch: 'main' }).run();
    db.insert(schema.files).values({ id: 'f_auth', projectId: 'p_test', path: 'src/auth.ts', language: 'TypeScript' }).run();
    db.insert(schema.symbols)
      .values([
        { id: 'symbol:src/auth.ts:login', fileId: 'f_auth', name: 'login', kind: 'function', startLine: 1, endLine: 3 },
        { id: 'symbol:src/auth.ts:TAG', fileId: 'f_auth', name: 'TAG', kind: 'variable', startLine: 5, endLine: 5 },
      ])
      .run();
    db.insert(schema.commits)
      .values([
        { sha: sha1, projectId: 'p_test', author: 'Test', message: 'feat: add login helper' },
        { sha: sha2, projectId: 'p_test', author: 'Test', message: 'fix: bump tag' },
      ])
      .run();
    db.insert(schema.commitFiles)
      .values([
        { commitSha: sha1, path: 'src/auth.ts', changeType: 'added' },
        { commitSha: sha2, path: 'src/auth.ts', changeType: 'modified' },
      ])
      .run();
    sqlite.close();

    // HEAD (sha2): exact match — TAG changed on line 5; line 7 has no symbol.
    const head = await inspectCommit(repo, sha2, dbPath);
    expect(head.approximate).toBe(false);
    expect(head.changedFiles).toEqual([{ path: 'src/auth.ts', changeType: 'modified' }]);
    expect(head.changedSymbols).toEqual([
      {
        symbolId: 'symbol:src/auth.ts:TAG',
        name: 'TAG',
        path: 'src/auth.ts',
        kind: 'variable',
        startLine: 5,
        endLine: 5,
        lines: [5],
      },
    ]);

    // Older commit (sha1 — root commit): approximate, and the whole file
    // counts as added so every span matches.
    const old = await inspectCommit(repo, sha1, dbPath);
    expect(old.approximate).toBe(true);
    expect(old.changedSymbols.map((s) => s.name).sort()).toEqual(['TAG', 'login']);

    // hunksForCommit agrees with the raw git show output shape: line 5
    // modified plus two appended lines (6 = blank, 7 = comment).
    const hunks = await hunksForCommit(repo, sha2);
    expect(hunks).toEqual([{ path: 'src/auth.ts', changeType: 'modified', newLines: [5, 6, 7] }]);
  }, 20_000);

  it('rejects an invalid commit-ish', async () => {
    const repo = tempDir();
    await $`git -C ${repo} init -b main -q`;
    await $`git -C ${repo} -c user.name=Test -c user.email=test@example.com commit -m init --allow-empty --quiet`;
    const dbPath = join(repo, '.featuremap', 'test.db');
    await expect(inspectCommit(repo, 'does-not-exist', dbPath)).rejects.toThrow();
  }, 20_000);
});