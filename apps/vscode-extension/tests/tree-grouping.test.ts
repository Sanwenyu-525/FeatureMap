/**
 * Pure grouping logic for the Feature Explorer (v0.6.1) — derived from
 * explainable health states, never invented percentages (AGENTS.md §7).
 */
import { describe, expect, it } from 'vitest';
import type { IdeFeature } from '../src/client/featuremap-client';
import { featureHealthState, groupFeatures, STATUS_GROUPS } from '../src/providers/tree-grouping';

function feature(overrides: Partial<IdeFeature> = {}): IdeFeature {
  return {
    id: 'feature:x',
    name: 'X',
    pattern: 'Generic',
    confidence: 0.9,
    status: 'active',
    ...overrides,
  };
}

describe('featureHealthState', () => {
  it('reads the implementation dimension', () => {
    expect(featureHealthState(feature({ health: { implementation: 'complete' } }))).toBe('complete');
  });

  it('falls back to unknown when health is absent', () => {
    expect(featureHealthState(feature())).toBe('unknown');
  });
});

describe('groupFeatures', () => {
  it('flat mode returns a single group with every feature', () => {
    const a = feature({ health: { implementation: 'complete' } });
    const b = feature({ health: { implementation: 'missing' } });
    const groups = groupFeatures([a, b], 'flat');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.features).toHaveLength(2);
    expect(groups[0]?.key).toBe('all');
  });

  it('status mode groups by primary health state in canonical order', () => {
    const complete = feature({ health: { implementation: 'complete' } });
    const missing = feature({ health: { implementation: 'missing' } });
    const unknown = feature();
    const groups = groupFeatures([unknown, complete, missing], 'status');
    const keys = groups.map((g) => g.key);
    expect(keys).toEqual(['complete', 'missing', 'unknown']);
    // Canonical order follows STATUS_GROUPS; unknown is last.
    const order = STATUS_GROUPS.map((g) => g.key);
    expect([...keys].sort((x, y) => order.indexOf(x) - order.indexOf(y))).toEqual(keys);
  });

  it('omits empty groups', () => {
    const groups = groupFeatures([feature({ health: { implementation: 'complete' } })], 'status');
    expect(groups.map((g) => g.key)).toEqual(['complete']);
  });

  it('keeps feature order stable within a group', () => {
    const a = feature({ id: 'feature:a', health: { implementation: 'partial' } });
    const b = feature({ id: 'feature:b', health: { implementation: 'partial' } });
    const groups = groupFeatures([a, b], 'status');
    expect(groups[0]?.features.map((f) => f.id)).toEqual(['feature:a', 'feature:b']);
  });
});
