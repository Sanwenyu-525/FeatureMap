/**
 * Drift → Problems mapping tests (v0.6.4 plan §76–§78).
 *
 * The adapter converts 1-based RPC lines to 0-based VS Code lines,
 * maps drift kinds to severities, and skips issues without a location.
 */
import { describe, expect, it } from 'vitest';
import type { IdeDriftIssue } from '../src/client/featuremap-client';
import { mapDriftToDiagnostics } from '../src/providers/drift-map';

const issue = (overrides: Partial<IdeDriftIssue> = {}): IdeDriftIssue => ({
  id: 'x',
  kind: 'new_candidate',
  featureId: 'feature:a',
  featureName: 'A',
  targetId: 'symbol:src/a.ts:foo',
  targetType: 'symbol',
  reason: 'r',
  location: { filePath: 'src/a.ts', startLine: 10 },
  ...overrides,
});

describe('mapDriftToDiagnostics', () => {
  it('converts 1-based to 0-based lines', () => {
    const mapped = mapDriftToDiagnostics([issue()]);
    expect(mapped[0]?.line).toBe(9);
  });

  it('maps relation_broken → warning and new_candidate → information', () => {
    const broken = mapDriftToDiagnostics([issue({ kind: 'relation_broken' })])[0];
    const candidate = mapDriftToDiagnostics([issue()])[0];
    expect(broken?.severity).toBe('warning');
    expect(candidate?.severity).toBe('information');
  });

  it('sets code to the exact drift type', () => {
    const mapped = mapDriftToDiagnostics([issue({ kind: 'relation_broken' })])[0];
    expect(mapped?.code).toBe('relation_broken');
  });

  it('skips issues without a resolvable location (plan §23)', () => {
    const mapped = mapDriftToDiagnostics([issue({ location: undefined })]);
    expect(mapped).toEqual([]);
  });

  it('keeps the issue count in the message', () => {
    const mapped = mapDriftToDiagnostics([issue({ kind: 'relation_broken', featureName: 'Auth' })])[0];
    expect(mapped?.message).toContain('Auth');
  });
});
