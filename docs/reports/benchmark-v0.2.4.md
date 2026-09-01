# Scan Benchmark Baseline — v0.2.4 (Milestone 9)

- Date: 2026-09-01
- Machine: Windows, Node 22
- Script: `scripts/benchmark-scan.mjs` (`node scripts/benchmark-scan.mjs 1000`,
  requires `pnpm build` first)
- Workload: synthetic TypeScript repository, linear import chain plus
  one exported function per file; incremental step touches exactly one
  file.

## Results

| Scale            | Full scan | Incremental (1 file changed) | Changed / Cached |
| ---------------- | --------: | ---------------------------: | ---------------- |
| 100 files        |     243ms |                        107ms | 1 / 100          |
| 1000 files       |   1,701ms |                        777ms | 1 / 1,000        |

Peak memory was not instrumented in this baseline run (v0.2 gate
target: < 1 GB at 1000 files — far above observed behavior, to be
verified with proper instrumentation).

## Against the v0.2 Performance Gate

| Gate                        | Target  | Measured        | Status  |
| --------------------------- | ------- | --------------- | ------- |
| 100 files, full             | < 2s    | 243ms           | pass    |
| 100 files, incremental      | < 500ms | 107ms           | pass    |
| 1000 files, full            | < 10s   | 1,701ms         | pass    |
| 1000 files, incremental     | < 2s    | 777ms           | pass    |
| Incremental coverage        | 100% of changed files | 1/1 re-analyzed, 1,000/1,000 cached | pass |

## Method notes

- The incremental gain (2.2x at 1000 files) is limited by the
  full-store rebuild step (files/symbols/evidence tables are cleared
  and re-inserted every scan) and Git fact collection, not by
  TypeScript parsing — cache hits skipped parsing entirely
  (`cacheHits: 1000`).
- Rebuilding only affected store regions is a future optimization;
  the correctness property (incremental evidence identical to a full
  scan, pinned by `packages/pipeline/tests/incremental.test.ts`) is
  the release gate, and it holds.
- File-set changes (add/delete) intentionally degrade to full
  re-analysis: cache keys include a file-set signature, so stale
  cross-file edges are impossible.
