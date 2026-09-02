/**
 * Stage 3 baseline (v0.7.1, Milestone 26 §Stage 3).
 *
 * Runs the whole corpus with a fresh DB per fixture, asserts the runner
 * is deterministic and records the baseline JSON to
 * `docs/quality/mapping-baseline.json`. No numeric gate yet — the
 * baseline is measured first; Stage 6 gates against it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateQualityGate, renderGate } from '../src/quality/gate.js';
import { renderBenchmarkReport, runBenchmarkSuite } from '../src/quality/report.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures');

describe('Mapping benchmark baseline (Stage 3)', () => {
  it('runs over all fixtures, is deterministic and reports computable metrics', async () => {
    const a = await runBenchmarkSuite(fixturesDir);
    const b = await runBenchmarkSuite(fixturesDir);
    expect(a.aggregate).toEqual(b.aggregate);
    expect(a.fixtures).toHaveLength(6);

    const agg = a.aggregate;
    for (const v of [
      agg.overall.precision,
      agg.overall.recall,
      agg.highConfidence.falsePositiveRate,
      agg.sharedInfrastructure.falsePromotionRate,
      agg.ambiguity.wrongOwnershipRate,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(agg.overall.truePositive).toBeGreaterThan(0);

    // Record the baseline for Stage 6 gating.
    const reportDir = join(dirname(fixturesDir), 'docs', 'quality');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'mapping-baseline.json'), `${JSON.stringify(agg, null, 2)}\n`, 'utf8');
  });

  it('renders a human-readable report', async () => {
    const suite = await runBenchmarkSuite(fixturesDir);
    const report = renderBenchmarkReport(suite);
    console.log('\n' + report + '\n');
    expect(report).toContain('Mapping Quality');
    expect(report).toContain('Precision');
    expect(report).toContain('High Confidence');
    expect(report).toContain('Shared Infrastructure');
  });

  it('passes the Stage 6 quality gate (high-confidence FP < 10%)', async () => {
    const suite = await runBenchmarkSuite(fixturesDir);
    const gate = evaluateQualityGate(suite.aggregate);
    console.log('\n' + renderGate(gate) + '\n');
    expect(gate.pass).toBe(true);
    expect(suite.aggregate.highConfidence.falsePositive).toBe(0);
  });
});
