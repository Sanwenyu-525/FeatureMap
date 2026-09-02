/**
 * Baseline report (v0.7.1, Milestone 26 §Stage 3).
 *
 * Runs the benchmark over every corpus fixture and renders a
 * deterministic aggregate report (terminal table + JSON). No numeric
 * gate yet — the baseline is recorded first, then failure
 * classification and deterministic fixes follow.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMappingBenchmark, type MappingBenchmarkResult } from './benchmark.js';

export const BENCHMARK_FIXTURES = [
  '01-simple-login',
  '02-react-login',
  '03-nextjs-auth',
  '04-shared-utils',
  '05-monorepo',
  '06-cross-feature',
];

export interface BenchmarkSuiteResult {
  fixtures: MappingBenchmarkResult[];
  aggregate: {
    overall: { precision: number; recall: number; truePositive: number; falsePositive: number; falseNegative: number };
    highConfidence: { displayed: number; falsePositive: number; falsePositiveRate: number };
    sharedInfrastructure: { total: number; falsePromotions: number; falsePromotionRate: number };
    ambiguity: { total: number; wrongOwnership: number; wrongOwnershipRate: number };
    failures: number;
  };
}

function sumMetric(key: 'truePositive' | 'falsePositive' | 'falseNegative', results: MappingBenchmarkResult[]): number {
  return results.reduce((n, r) => n + r.overall[key], 0);
}

export function aggregateBenchmark(results: MappingBenchmarkResult[]): BenchmarkSuiteResult['aggregate'] {
  const truePositive = sumMetric('truePositive', results);
  const falsePositive = sumMetric('falsePositive', results);
  const falseNegative = sumMetric('falseNegative', results);
  const displayed = results.reduce((n, r) => n + r.highConfidence.displayed, 0);
  const hcFP = results.reduce((n, r) => n + r.highConfidence.falsePositive, 0);
  const sharedTotal = results.reduce((n, r) => n + r.sharedInfrastructure.total, 0);
  const sharedFP = results.reduce((n, r) => n + r.sharedInfrastructure.falsePromotions, 0);
  const ambTotal = results.reduce((n, r) => n + r.ambiguity.total, 0);
  const ambWrong = results.reduce((n, r) => n + r.ambiguity.wrongOwnership, 0);
  const failures = results.reduce((n, r) => n + r.failures.length, 0);
  return {
    overall: {
      precision: truePositive + falsePositive === 0 ? 1 : truePositive / (truePositive + falsePositive),
      recall: truePositive + falseNegative === 0 ? 1 : truePositive / (truePositive + falseNegative),
      truePositive,
      falsePositive,
      falseNegative,
    },
    highConfidence: { displayed, falsePositive: hcFP, falsePositiveRate: displayed === 0 ? 0 : hcFP / displayed },
    sharedInfrastructure: { total: sharedTotal, falsePromotions: sharedFP, falsePromotionRate: sharedTotal === 0 ? 0 : sharedFP / sharedTotal },
    ambiguity: { total: ambTotal, wrongOwnership: ambWrong, wrongOwnershipRate: ambTotal === 0 ? 0 : ambWrong / ambTotal },
    failures,
  };
}

/** Run the whole corpus; each fixture gets a fresh temp DB (no pollution). */
export async function runBenchmarkSuite(fixturesDir: string): Promise<BenchmarkSuiteResult> {
  const results: MappingBenchmarkResult[] = [];
  for (const fx of BENCHMARK_FIXTURES) {
    const dir = mkdtempSync(join(tmpdir(), 'fm-bench-'));
    try {
      results.push(await runMappingBenchmark(join(fixturesDir, fx), { dbPath: join(dir, 'fm.db') }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { fixtures: results, aggregate: aggregateBenchmark(results) };
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function renderBenchmarkReport(suite: BenchmarkSuiteResult): string {
  const a = suite.aggregate;
  const out: string[] = ['Mapping Quality', ''];
  out.push('Overall');
  out.push(`  Precision   ${pct(a.overall.precision)}`);
  out.push(`  Recall      ${pct(a.overall.recall)}`);
  out.push(`  TP ${a.overall.truePositive}  FP ${a.overall.falsePositive}  FN ${a.overall.falseNegative}`);
  out.push('');
  out.push('High Confidence');
  out.push(`  False Positive  ${pct(a.highConfidence.falsePositiveRate)}  (${a.highConfidence.falsePositive}/${a.highConfidence.displayed})`);
  out.push('');
  out.push('Shared Infrastructure');
  out.push(`  False Promotion ${pct(a.sharedInfrastructure.falsePromotionRate)}  (${a.sharedInfrastructure.falsePromotions}/${a.sharedInfrastructure.total})`);
  out.push('');
  out.push('Cross-feature');
  out.push(`  Wrong Ownership ${pct(a.ambiguity.wrongOwnershipRate)}  (${a.ambiguity.wrongOwnership}/${a.ambiguity.total})`);
  out.push('');
  out.push(`Failures: ${a.failures}`);
  for (const f of suite.fixtures) {
    out.push(`  ${f.fixture.split('/').pop()}: P=${pct(f.overall.precision)} R=${pct(f.overall.recall)} HC-FP=${pct(f.highConfidence.falsePositiveRate)} (${f.failures.length} failures)`);
  }
  return out.join('\n');
}
