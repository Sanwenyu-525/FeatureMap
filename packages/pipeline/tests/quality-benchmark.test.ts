/**
 * Stage 2–3 tests (v0.7.1, Milestone 26) — the benchmark runner's
 * metrics, failure classification and determinism.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateBenchmark, runMappingBenchmark } from '../src/quality/benchmark.js';
import { parseMappingBenchmark } from '../src/quality/load.js';
import type { ScanJsonOutput } from '../src/scan-runner.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures');

/** Minimal scan for the pure evaluation tests (only candidates are read). */
function mockScan(candidates: ScanJsonOutput['candidates']): ScanJsonOutput {
  return {
    project: { name: 'mock', root: '/mock', baseBranch: 'main' },
    technologies: [],
    counts: {
      files: 0, symbols: 0, endpoints: 0, dataEntities: 0, documents: 0, instructions: 0,
      features: 0, candidates: candidates.length, evidence: 0, commits: 0,
      changedFiles: 0, cachedFiles: 0,
    },
    files: [], symbols: [], endpoints: [], documents: [], features: [], candidates,
    commits: [], evidence: [], runs: [],
  };
}

const spec01 = parseMappingBenchmark(`
{
  "version": 1,
  "features": [
    { "id": "login",
      "expected": [
        { "target": { "type": "file", "path": "src/server.ts" }, "relation": "OWNS", "confidenceClass": "must-high" },
        { "target": { "type": "file", "path": "src/auth/auth-service.ts" }, "relation": "OWNS", "confidenceClass": "must-high" }
      ],
      "notExpected": [
        { "target": { "type": "file", "path": "src/shared/logger.ts" }, "relation": "OWNS", "confidenceClass": "must-not-high", "tags": ["shared-infra"] }
      ] }
  ],
  "entities": [
    { "target": { "type": "file", "path": "src/shared/logger.ts" }, "tags": ["shared-infra", "high-fanin"] }
  ]
}
`);

function candidate(partial: Partial<ScanJsonOutput['candidates'][number]>): ScanJsonOutput['candidates'][number] {
  return {
    featureId: 'feature:login',
    targetType: 'file',
    targetId: 'src/x.ts',
    relation: 'owns',
    status: 'suggested',
    score: 0.9,
    distance: 1,
    fanIn: 1,
    ...partial,
  };
}

describe('evaluateBenchmark — metrics (Stage 2/3)', () => {
  it('computes precision and recall from expected vs predicted', () => {
    const result = evaluateBenchmark({
      fixture: '01',
      spec: spec01,
      scan: mockScan([
        candidate({ targetId: 'src/server.ts', relation: 'owns', score: 1, status: 'declared' }),
        candidate({ targetId: 'src/auth/auth-service.ts', relation: 'owns', score: 0.95 }),
        candidate({ targetId: 'src/unexpected.ts', relation: 'DEPENDS_ON', score: 0.7 }),
      ]),
    });
    // 2 expected found, 1 extra → precision 2/3, recall 2/2.
    expect(result.overall.truePositive).toBe(2);
    expect(result.overall.falsePositive).toBe(1);
    expect(result.overall.precision).toBeCloseTo(2 / 3);
    expect(result.overall.recall).toBe(1);
    // A false_positive failure is recorded for the unexpected candidate.
    expect(result.failures.some((f) => f.type === 'false_positive' && f.actual === 'DEPENDS_ON')).toBe(true);
  });

  it('flags a hard negative that reached high confidence', () => {
    const result = evaluateBenchmark({
      fixture: '01',
      spec: spec01,
      scan: mockScan([
        candidate({ targetId: 'src/server.ts', score: 1, status: 'declared' }),
        candidate({ targetId: 'src/auth/auth-service.ts', score: 0.95 }),
        candidate({ targetId: 'src/shared/logger.ts', relation: 'owns', score: 0.96 }),
      ]),
    });
    expect(result.highConfidence.falsePositive).toBe(1);
    expect(result.highConfidence.falsePositiveRate).toBeCloseTo(1 / 3);
    expect(result.failures.some((f) => f.type === 'high_confidence_false_positive' && f.target.path === 'src/shared/logger.ts')).toBe(true);
    // Shared-infra promotion: logger surfaced as high-confidence OWNS.
    expect(result.sharedInfrastructure.falsePromotions).toBe(1);
    expect(result.sharedInfrastructure.total).toBe(1);
  });

  it('detects wrong ownership (expected DEPENDS_ON promoted to OWNS)', () => {
    // A DEPENDS_ON expectation surfacing as high-confidence OWNS is
    // ownership inflation.
    const spec2 = parseMappingBenchmark(`
      { "version": 1, "features": [
        { "id": "login", "expected": [
          { "target": { "type": "file", "path": "src/dep.ts" }, "relation": "DEPENDS_ON", "confidenceClass": "may-suggest" }
        ] }
      ] }
    `);
    const r2 = evaluateBenchmark({
      fixture: '01',
      spec: spec2,
      scan: mockScan([candidate({ targetId: 'src/dep.ts', relation: 'owns', score: 0.95 })]),
    });
    expect(r2.ambiguity.wrongOwnership).toBe(1);
    expect(r2.ambiguity.total).toBe(1);
    expect(r2.failures.some((f) => f.type === 'wrong_ownership' && f.expected === 'DEPENDS_ON' && f.actual === 'OWNS')).toBe(true);
  });

  it('is deterministic: the same scan + spec yield identical results', () => {
    const scan = mockScan([
      candidate({ targetId: 'src/server.ts', score: 1, status: 'declared' }),
      candidate({ targetId: 'src/auth/auth-service.ts', score: 0.95 }),
      candidate({ targetId: 'src/shared/logger.ts', relation: 'owns', score: 0.96 }),
    ]);
    const a = evaluateBenchmark({ fixture: '01', spec: spec01, scan });
    const b = evaluateBenchmark({ fixture: '01', spec: spec01, scan });
    expect(a).toEqual(b);
  });
});

describe('runMappingBenchmark — integration determinism (Stage 2)', () => {
  it('reproduces byte-identical results across runs on a fixture', async () => {
    const fixtureRoot = join(fixturesDir, '01-simple-login');
    const dirA = mkdtempSync(join(tmpdir(), 'fm-bench-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'fm-bench-b-'));
    try {
      const a = await runMappingBenchmark(fixtureRoot, { dbPath: join(dirA, 'fm.db') });
      const b = await runMappingBenchmark(fixtureRoot, { dbPath: join(dirB, 'fm.db') });
      expect(a).toEqual(b);
      expect(a.features).toBeGreaterThan(0);
      expect(a.overall.truePositive).toBeGreaterThan(0);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
