/**
 * Stage 4 tests (v0.7.1, Milestone 26 §Stage 4) — failure
 * classification: deterministic / unsupported / annotation / semantic.
 */
import { describe, expect, it } from 'vitest';
import { classifyFailure, classifyFailures } from '../src/quality/classify.js';
import type { MappingFailure, MappingFailureType } from '../src/quality/benchmark.js';

function failure(partial: Partial<MappingFailure>): MappingFailure {
  return {
    fixture: '01',
    type: 'false_positive',
    featureId: 'feature:login',
    target: { type: 'file', path: 'src/x.ts' },
    tags: [],
    ...partial,
  };
}

describe('classifyFailure (Stage 4)', () => {
  it('maps product-safety failures to deterministic-fixable', () => {
    for (const type of ['high_confidence_false_positive', 'shared_infra_promotion', 'wrong_ownership'] as MappingFailureType[]) {
      expect(classifyFailure(failure({ type }))).toBe('deterministic-fixable');
    }
  });

  it('treats UI-reachability false negatives as unsupported', () => {
    const f = failure({ type: 'false_negative', target: { type: 'file', path: 'src/login/LoginPage.tsx' } });
    expect(classifyFailure(f)).toBe('unsupported');
  });

  it('treats other false negatives as deterministic-fixable', () => {
    const f = failure({ type: 'false_negative', target: { type: 'symbol', path: 'src/auth/service.ts', symbol: 'login' } });
    expect(classifyFailure(f)).toBe('deterministic-fixable');
  });

  it('treats untagged unexpected candidates as annotation-error', () => {
    expect(classifyFailure(failure({ type: 'false_positive', tags: [] }))).toBe('annotation-error');
  });

  it('treats tagged shared-infra false positives as deterministic-fixable', () => {
    expect(classifyFailure(failure({ type: 'false_positive', tags: ['shared-infra'] }))).toBe('deterministic-fixable');
  });

  it('summarizes by category with top targets', () => {
    const summary = classifyFailures([
      failure({ type: 'high_confidence_false_positive', target: { type: 'symbol', path: 'a.ts', symbol: 'log' } }),
      failure({ type: 'false_positive' }),
      failure({ type: 'false_negative', target: { type: 'file', path: 'src/login/LoginPage.tsx' } }),
    ]);
    expect(summary.byCategory['deterministic-fixable']).toBe(1);
    expect(summary.byCategory['annotation-error']).toBe(1);
    expect(summary.byCategory['unsupported']).toBe(1);
    const cats = Object.values(summary.byCategory) as number[];
    expect(cats.reduce((n, c) => n + c, 0)).toBe(3);
  });
});

describe('classifyFailures — real baseline breakdown (Stage 4)', () => {
  it('classifies the live corpus failures and reports the breakdown', async () => {
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { runBenchmarkSuite } = await import('../src/quality/report.js');
    const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures');
    const suite = await runBenchmarkSuite(fixturesDir);
    const failures = suite.fixtures.flatMap((f) => f.failures);
    const summary = classifyFailures(failures);
    const total = Object.values(summary.byCategory).reduce((n, c) => n + c, 0);
    expect(total).toBe(failures.length);
    // Deterministic + annotation buckets must cover the majority; semantic
    // ambiguity should be rare at this stage (structural rules dominate).
    const sem = summary.byCategory['semantic-ambiguous'];
    expect(sem).toBe(0);
    console.log(`\nClassified ${total} failures: ${JSON.stringify(summary.byCategory)}\n`);
    console.log(`Deterministic top: ${JSON.stringify(summary.top['deterministic-fixable'], null, 0)}`);
    console.log(`Annotation top: ${JSON.stringify(summary.top['annotation-error'], null, 0)}\n`);
  });
});
