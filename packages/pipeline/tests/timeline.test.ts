/**
 * Feature timeline tests — Milestone 14 (docs/DEVELOPMENT_PLAN.md),
 * ADR-0004 §6.
 *
 * Pinned behavior:
 * - per-feature history is derived at query time from stored commits
 * - commits are filtered to those touching the feature's asset paths
 * - change kinds parse conventional-commit prefixes; sorted newest first
 * - contributors aggregate per author; unknown feature throws
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import { assetId } from '@featuremap/analyzer';
import { openDatabase, schema } from '@featuremap/db';
import { featureTimeline } from '../src/timeline.js';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-timeline-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('featureTimeline (ADR-0004 §6)', () => {
  it('derives per-feature commits, kinds, contributors and stats from stored commits', async () => {
    const repo = join(tempDir(), 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    const git = (...args: string[]) =>
      $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
    await $`git -C ${repo} init -b main -q`;

    writeFileSync(join(repo, 'src/auth.ts'), "export const ok = true;\n", 'utf8');
    await git('add', 'src/auth.ts');
    await git('commit', '-m', 'feat: add auth', '--quiet');
    const { stdout: featSha } = await git('rev-parse', 'HEAD');

    writeFileSync(join(repo, 'src/auth.ts'), "export const ok = true;\nexport const also = true;\n", 'utf8');
    await git('add', 'src/auth.ts');
    await git('commit', '-m', 'fix: relax check', '--quiet');
    const { stdout: fixSha } = await git('rev-parse', 'HEAD');

    const dbPath = join(tempDir(), 'featuremap.db');
    const { db, sqlite } = openDatabase(dbPath);
    db.insert(schema.projects).values({ id: 'p_tl', name: 'tl', root: repo, baseBranch: 'main' }).run();
    db.insert(schema.files)
      .values({ id: assetId({ type: 'file', path: 'src/auth.ts' }), projectId: 'p_tl', path: 'src/auth.ts' })
      .run();
    db.insert(schema.assets)
      .values({ id: assetId({ type: 'file', path: 'src/auth.ts' }), type: 'file', path: 'src/auth.ts' })
      .run();
    db.insert(schema.features)
      .values({ id: 'feature:auth', name: 'Auth', pattern: 'Authentication', confidence: 0.9 })
      .run();
    db.insert(schema.featureAssets)
      .values({ featureId: 'feature:auth', assetId: assetId({ type: 'file', path: 'src/auth.ts' }), confidence: 0.9 })
      .run();
    db.insert(schema.commits)
      .values([
        { sha: featSha.trim(), projectId: 'p_tl', author: 'Test', committedAt: '2026-08-01T10:00:00Z', message: 'feat: add auth' },
        { sha: fixSha.trim(), projectId: 'p_tl', author: 'Test', committedAt: '2026-08-02T10:00:00Z', message: 'fix: relax check' },
      ])
      .run();
    db.insert(schema.commitFiles)
      .values([
        { commitSha: featSha.trim(), path: 'src/auth.ts', changeType: 'added' },
        { commitSha: fixSha.trim(), path: 'src/auth.ts', changeType: 'modified' },
      ])
      .run();
    sqlite.close();

    const tl = featureTimeline(repo, 'feature:auth', dbPath);
    expect(tl.featureName).toBe('Auth');
    expect(tl.commits).toHaveLength(2);
    // Newest first (lexicographic ISO committedAt).
    expect(tl.commits[0]?.kind).toBe('fix');
    expect(tl.commits[0]?.changedPaths).toEqual(['src/auth.ts']);
    expect(tl.commits[1]?.kind).toBe('feat');
    // Contributors + stats.
    expect(tl.contributors).toEqual([{ name: 'Test', count: 2 }]);
    expect(tl.stats.commitCount).toBe(2);
    expect(tl.stats.fileCount).toBe(1);
    expect(tl.stats.contributorCount).toBe(1);
    expect(tl.stats.changeKinds).toEqual({ feat: 1, fix: 1 });
  });

  it('ignores commits that do not touch the feature assets', async () => {
    const repo = join(tempDir(), 'repo2');
    mkdirSync(join(repo, 'src'), { recursive: true });
    const git = (...args: string[]) =>
      $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
    await $`git -C ${repo} init -b main -q`;
    writeFileSync(join(repo, 'src/other.ts'), "export const x = 1;\n", 'utf8');
    await git('add', 'src/other.ts');
    await git('commit', '-m', 'chore: unrelated', '--quiet');
    const { stdout: sha } = await git('rev-parse', 'HEAD');

    const dbPath = join(tempDir(), 'featuremap2.db');
    const { db, sqlite } = openDatabase(dbPath);
    db.insert(schema.projects).values({ id: 'p_p2', name: 'tl2', root: repo, baseBranch: 'main' }).run();
    db.insert(schema.assets)
      .values({ id: assetId({ type: 'file', path: 'src/auth.ts' }), type: 'file', path: 'src/auth.ts' })
      .run();
    db.insert(schema.features)
      .values({ id: 'feature:auth', name: 'Auth', pattern: 'Authentication', confidence: 0.9 })
      .run();
    db.insert(schema.featureAssets)
      .values({ featureId: 'feature:auth', assetId: assetId({ type: 'file', path: 'src/auth.ts' }), confidence: 0.9 })
      .run();
    db.insert(schema.commits)
      .values({ sha: sha.trim(), projectId: 'p_p2', author: 'Test', committedAt: '2026-08-01T10:00:00Z', message: 'chore: unrelated' })
      .run();
    db.insert(schema.commitFiles)
      .values({ commitSha: sha.trim(), path: 'src/other.ts', changeType: 'added' })
      .run();
    sqlite.close();

    const tl = featureTimeline(repo, 'feature:auth', dbPath);
    expect(tl.commits).toEqual([]);
    expect(tl.stats.commitCount).toBe(0);
    expect(tl.stats.changeKinds).toEqual({});
  });

  it('throws for an unknown feature', () => {
    const repo = tempDir();
    const dbPath = join(tempDir(), 'nostore.db');
    expect(() => featureTimeline(repo, 'feature:nope', dbPath)).toThrow(/does not exist/);
  });
});