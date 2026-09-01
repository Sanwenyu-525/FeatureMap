/**
 * Incremental scan tests — Milestone 9 (docs/DEVELOPMENT_PLAN.md),
 * docs/releases/v0.2-acceptance.md §1/§3/§9.
 *
 * Pinned behavior:
 * - unchanged files hit the analysis cache (never re-parsed)
 * - incremental evidence is identical to a full scan's evidence
 * - file-set changes (add/remove) degrade to full re-analysis
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { typescriptAnalyzer } from '@featuremap/analyzer';
import type { AnalyzeContext, AnalysisCache } from '@featuremap/analyzer';
import { runScan } from '../src/scan-runner.js';

const FIXTURE_01 = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  '01-simple-login',
);

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-incr-'));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** In-memory analysis cache with hit/miss counters. */
function memoryCache(): AnalysisCache & { hits: number; misses: number } {
  const store = new Map<string, unknown>();
  return {
    hits: 0,
    misses: 0,
    get(key: string): unknown | undefined {
      const value = store.get(key);
      if (value === undefined) {
        this.misses += 1;
        return undefined;
      }
      this.hits += 1;
      return value;
    },
    put(key: string, payload: unknown): void {
      store.set(key, payload);
    },
  };
}

function copyFixture(): string {
  const root = tempDir();
  cpSync(FIXTURE_01, root, { recursive: true });
  return root;
}

describe('typescript analyzer analysis cache', () => {
  const files = ['src/server.ts', 'src/auth/login.ts', 'src/auth/auth-service.ts'].map((path) => ({
    path,
    hash: 'h-' + path,
    size: 10,
    language: 'TypeScript',
  }));
  // Real file contents: hashes above are fake, so the analyzer must read.
  const repoRoot = FIXTURE_01;
  const readFile = (path: string): string | undefined => {
    try {
      return readFileSync(join(repoRoot, path), 'utf8');
    } catch {
      return undefined;
    }
  };
  const baseContext = {
    repoRoot,
    files,
    readFile,
    config: { analyzers: ['typescript'], scan: { baseBranch: 'main', ignore: [] } },
  } as unknown as AnalyzeContext;

  it('replays cached files with identical evidence output', () => {
    const cache = memoryCache();
    // Cold cache: everything misses.
    const first = typescriptAnalyzer.analyze({ ...baseContext, cache, fileSetKey: 'set-1' });
    expect(first.stats?.cacheMisses).toBe(files.length);
    expect(first.stats?.cacheHits).toBe(0);

    // Second run: everything hits.
    const second = typescriptAnalyzer.analyze({ ...baseContext, cache, fileSetKey: 'set-1' });
    expect(second.stats?.cacheHits).toBe(files.length);
    expect(second.stats?.cacheMisses).toBe(0);

    const keyOf = (e: { sourceId: string; relationType: string; targetId: string }) =>
      `${e.sourceId}|${e.relationType}|${e.targetId}`;
    const sort = (rows: Array<Record<string, unknown>>) =>
      rows.map(keyOf).sort();
    expect(sort(second.evidence as Array<Record<string, unknown>>)).toEqual(
      sort(first.evidence as Array<Record<string, unknown>>),
    );
    expect(second.assets.map((a) => a.path)).toEqual(first.assets.map((a) => a.path));
  });

  it('invalidates the whole cache when the file-set signature changes', () => {
    const cache = memoryCache();
    typescriptAnalyzer.analyze({ ...baseContext, cache, fileSetKey: 'set-1' });
    const after = typescriptAnalyzer.analyze({ ...baseContext, cache, fileSetKey: 'set-2' });
    expect(after.stats?.cacheHits).toBe(0);
    expect(after.stats?.cacheMisses).toBe(files.length);
  });
});

describe('incremental runScan on fixture 01', () => {
  it('re-analyzes only the changed file and keeps evidence identical', async () => {
    const root = copyFixture();
    const dbPath = join(tempDir(), 'scan.db');

    // First scan: everything is changed (no previous hashes).
    const first = await runScan(root, { dbPath });
    expect(first.counts.changedFiles).toBe(first.counts.files);
    expect(first.counts.cachedFiles).toBe(0);

    // Modify exactly one file, then rescan incrementally.
    const target = join(root, 'src/auth/login.ts');
    writeFileSync(target, readFileSync(target, 'utf8') + '\n// touched\n', 'utf8');
    const incremental = await runScan(root, { dbPath });
    expect(incremental.counts.changedFiles).toBe(1);
    expect(incremental.counts.cachedFiles).toBe(first.counts.files - 1);
    const tsRun = incremental.runs.find((r) => r.analyzerId === 'typescript');
    expect(tsRun?.stats['cacheHits']).toBeGreaterThan(0);

    // Correctness: a from-scratch full scan of the same tree must
    // produce identical evidence ids.
    const baselineDb = join(tempDir(), 'baseline.db');
    const baseline = await runScan(root, { dbPath: baselineDb });
    const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
    expect(idsOf(incremental.evidence)).toEqual(idsOf(baseline.evidence));
  });

  it('degrades to full re-analysis when a file is added', async () => {
    const root = copyFixture();
    const dbPath = join(tempDir(), 'scan.db');
    await runScan(root, { dbPath });

    writeFileSync(join(root, 'src/auth/extra.ts'), 'export const extra = 1;\n', 'utf8');
    const second = await runScan(root, { dbPath });
    // File-set signature changed → no stale cache hits.
    const tsRun = second.runs.find((r) => r.analyzerId === 'typescript');
    expect(tsRun?.stats['cacheHits']).toBe(0);
    // The new file is fully integrated into the graph.
    expect(second.symbols.some((s) => s.name === 'extra')).toBe(true);
  });
});
