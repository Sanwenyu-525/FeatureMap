/**
 * Live Change Impact tests (v0.6.3 plan §28–§31).
 *
 * refreshCurrentImpact is exercised against a real temp git repo (a
 * copy of fixture 01): save → incremental scan → WORKING_TREE impact →
 * generation-guarded snapshot. savedFiles is a hint; the impact scope
 * is the whole working tree.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCurrentImpactStore,
  getCurrentImpact,
  refreshCurrentImpact,
  type CurrentImpactSnapshot,
} from '../src/live-impact/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', '01-simple-login');

let repo: string;
let dbPath: string;
const store = createCurrentImpactStore();
const tempDirs: string[] = [];

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'featuremap-live-'));
  tempDirs.push(repo);
  dbPath = join(repo, '.featuremap', 'test.db');
  // Copy the fixture into a real git repo so working-tree changes exist.
  cpSync(fixtureRoot, repo, { recursive: true, filter: (src) => !src.includes('.featuremap') });
  const git = (...args: string[]) =>
    $`git -C ${repo} -c user.name=Test -c user.email=test@example.com ${args}`;
  await git('init', '-b', 'main', '-q');
  await git('add', '.');
  await git('commit', '-m', 'feat: init fixture', '--quiet');
});

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('refreshCurrentImpact (plan §28)', () => {
  it('incremental refresh + WORKING_TREE impact yields a save snapshot', async () => {
    writeFileSync(join(repo, 'src/auth/login.ts'), "export function login() {\n  return 'v2';\n}\n", 'utf8');
    const { snapshot, refresh } = await refreshCurrentImpact(
      repo,
      { savedFiles: ['src/auth/login.ts'], trigger: 'save', dbPath },
      store,
    );
    expect(snapshot.trigger.type).toBe('save');
    expect(snapshot.trigger.savedFiles).toEqual(['src/auth/login.ts']);
    expect(snapshot.generation).toBe(1);
    expect(refresh.durationMs).toBeGreaterThan(0);
    expect(snapshot.affectedFeatures.length).toBeGreaterThan(0);
    const login = snapshot.affectedFeatures.find((f) => f.featureId === 'feature:login');
    expect(login).toBeDefined();
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(login!.severity);
    expect(snapshot.summary.affectedFeatureCount).toBe(snapshot.affectedFeatures.length);
  });

  it('impact scope is the whole working tree, not just savedFiles (plan §28.2)', async () => {
    writeFileSync(join(repo, 'src/auth/login.ts'), "export function login() {\n  return 'v3';\n}\n", 'utf8');
    writeFileSync(join(repo, 'src/auth/user-repository.ts'), "export function findByEmail() { return null; }\n", 'utf8');
    // savedFiles only names login.ts — the snapshot must still cover both.
    const { snapshot } = await refreshCurrentImpact(repo, { savedFiles: ['src/auth/login.ts'], dbPath }, store);
    const changed = snapshot.changedFiles.map((f) => f.path);
    expect(changed).toContain('src/auth/login.ts');
    expect(changed).toContain('src/auth/user-repository.ts');
    expect(snapshot.generation).toBe(2);
  });

  it('manual trigger is recorded and summary stays consistent', async () => {
    const { snapshot } = await refreshCurrentImpact(repo, { trigger: 'manual', dbPath }, store);
    expect(snapshot.trigger.type).toBe('manual');
    expect(snapshot.trigger.savedFiles).toEqual([]);
    const total = snapshot.summary.bySeverity.HIGH + snapshot.summary.bySeverity.MEDIUM + snapshot.summary.bySeverity.LOW;
    expect(total).toBe(snapshot.summary.affectedFeatureCount);
    expect(snapshot.generation).toBe(3);
  });
});

describe('CurrentImpactStore (plan §6/§29)', () => {
  it('reports unavailable before the first refresh, then serves the cached snapshot', async () => {
    const freshStore = createCurrentImpactStore();
    expect(getCurrentImpact(repo, freshStore)).toEqual({ available: false });
    await refreshCurrentImpact(repo, { trigger: 'manual', dbPath }, freshStore);
    const current = getCurrentImpact(repo, freshStore);
    expect(current.available).toBe(true);
    expect(current.snapshot?.generation).toBe(1);
    expect(current.snapshot?.summary.affectedFeatureCount).toBe(current.snapshot?.affectedFeatures.length);
  });

  it('generations increment per successful refresh', async () => {
    const freshStore = createCurrentImpactStore();
    await refreshCurrentImpact(repo, { trigger: 'manual', dbPath }, freshStore);
    const first = getCurrentImpact(repo, freshStore).snapshot as CurrentImpactSnapshot;
    await refreshCurrentImpact(repo, { trigger: 'manual', dbPath }, freshStore);
    const second = getCurrentImpact(repo, freshStore).snapshot as CurrentImpactSnapshot;
    expect(second.generation).toBe(first.generation + 1);
    expect(second.refreshedAt >= first.refreshedAt).toBe(true);
  });
});
