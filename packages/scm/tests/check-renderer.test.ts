/**
 * Check renderer tests — pure, deterministic (Phase 4 / ADR-0006 §3).
 */
import { describe, expect, it } from 'vitest';
import type { PrReport } from '@featuremap/pipeline';
import { DEFAULT_CHECK_NAME, renderPrCheck } from '../src/check-renderer.js';

function fixtureReport(overrides: Partial<PrReport> = {}): PrReport {
  return {
    range: 'main..HEAD',
    currentBranch: 'feature/x',
    baseBranch: 'main',
    changedFiles: [{ path: 'src/auth/auth.ts', changeType: 'modified', commitSha: 'main..HEAD' }],
    affectedFeatures: [
      {
        featureId: 'feature:login',
        featureName: 'Login',
        confidence: 1,
        severity: 'MEDIUM',
        reasons: ['src/auth/auth.ts belongs to this feature (0.9)'],
        tests: ['tests/auth/login.test.ts'],
        documents: [],
      },
    ],
    sharedInfrastructure: [],
    suppressedUncertainty: [],
    risk: { band: 'LOW', contributions: [] },
    testCoverage: [{ path: 'tests/auth/login.test.ts', status: 'recommended', featureId: 'feature:login', changed: true }],
    mappingDrift: [],
    staleDocuments: [],
    ...overrides,
  };
}

describe('renderPrCheck', () => {
  it('reports success for a low-risk, clean change', () => {
    const check = renderPrCheck(fixtureReport());
    expect(check.conclusion).toBe('success');
    expect(check.title).toBe(DEFAULT_CHECK_NAME);
    expect(check.summary).toContain('Affected features: 1');
    expect(check.summary).toContain('Risk: LOW');
    expect(check.text).toContain('| Severity | Feature | Reason |');
    expect(check.text).toContain('| MEDIUM | Login |');
    expect(check.text).toContain('✓ `tests/auth/login.test.ts`');
    expect(check.text).toContain('✓ No stale mapping detected.');
  });

  it('marks HIGH risk as neutral (review recommended)', () => {
    const check = renderPrCheck(
      fixtureReport({
        risk: { band: 'HIGH', contributions: [{ points: 1, reason: '直接核心功能变更：Login' }] },
      }),
    );
    expect(check.conclusion).toBe('neutral');
    expect(check.text).toContain('**HIGH**');
    expect(check.text).toContain('+1 直接核心功能变更');
  });

  it('marks a broken mapping relation as neutral regardless of risk', () => {
    const check = renderPrCheck(
      fixtureReport({
        mappingDrift: [
          {
            kind: 'relation_broken',
            featureId: 'feature:login',
            featureName: 'Login',
            targetId: 'src/auth/legacy.ts',
            targetType: 'file',
            reason: 'accepted file deleted — mapping may be stale',
          },
        ],
      }),
    );
    expect(check.conclusion).toBe('neutral');
    expect(check.text).toContain('**[relation_broken]** Login');
  });

  it('summarizes tests and drift counts', () => {
    const check = renderPrCheck(
      fixtureReport({
        testCoverage: [
          { path: 'tests/auth/login.test.ts', status: 'recommended', featureId: 'feature:login', changed: true },
          { path: 'tests/auth/session.test.ts', status: 'recommended', featureId: 'feature:session', changed: false },
        ],
      }),
    );
    expect(check.summary).toContain('Tests: ✓1 ⚠1');
    expect(check.text).toContain('⚠ `tests/auth/session.test.ts`');
  });

  it('sorts the impact table by severity', () => {
    const check = renderPrCheck(
      fixtureReport({
        affectedFeatures: [
          {
            featureId: 'feature:session',
            featureName: 'Session',
            confidence: 0.8,
            severity: 'LOW',
            reasons: ['low'],
            tests: [],
            documents: [],
          },
          {
            featureId: 'feature:login',
            featureName: 'Login',
            confidence: 1,
            severity: 'HIGH',
            reasons: ['high'],
            tests: [],
            documents: [],
          },
        ],
      }),
    );
    const highIdx = check.text.indexOf('| HIGH | Login |');
    const lowIdx = check.text.indexOf('| LOW | Session |');
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThan(highIdx);
  });
});
