/**
 * Quality gates (v0.7.1, Milestone 26 §Stage 6).
 *
 * Hard gate: the high-confidence false-positive rate must stay below
 * 10% — the product-safety number that protects Hover / CodeLens /
 * Impact / Context. Everything else (precision, recall, shared-infra
 * suppression, ambiguity) is reported softly; the recorded baseline in
 * `docs/quality/mapping-baseline.json` is the regression reference.
 */
import type { BenchmarkSuiteResult } from './report.js';

export const QUALITY_GATES = {
  /** Hard gate — hard negatives reaching high-confidence surfaces. */
  maxHighConfidenceFalsePositiveRate: 0.1,
} as const;

export interface GateCheck {
  name: string;
  pass: boolean;
  actual: string;
  threshold: string;
}

export interface QualityGateResult {
  pass: boolean;
  checks: GateCheck[];
}

export function evaluateQualityGate(aggregate: BenchmarkSuiteResult['aggregate']): QualityGateResult {
  const checks: GateCheck[] = [
    {
      name: 'high-confidence-fp',
      pass: aggregate.highConfidence.falsePositiveRate < QUALITY_GATES.maxHighConfidenceFalsePositiveRate,
      actual: `${(aggregate.highConfidence.falsePositiveRate * 100).toFixed(1)}%`,
      threshold: `< ${QUALITY_GATES.maxHighConfidenceFalsePositiveRate * 100}%`,
    },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

export function renderGate(result: QualityGateResult): string {
  const out = ['Quality Gate'];
  for (const c of result.checks) out.push(`  ${c.pass ? '✓' : '✗'} ${c.name}: ${c.actual} (${c.threshold})`);
  out.push(`  → ${result.pass ? 'PASS' : 'FAIL'}`);
  return out.join('\n');
}
