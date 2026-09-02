/**
 * Pure Feature grouping logic for the Explorer (v0.6.1).
 *
 * Kept free of the VS Code API so it is unit-testable. Grouping is
 * derived from the explainable feature health (AGENTS.md §7 — no
 * invented percentages): the implementation dimension's state is the
 * primary group key.
 */
import type { IdeFeature } from '../client/featuremap-client';

export type GroupMode = 'flat' | 'status';

export interface FeatureGroup {
  key: string;
  label: string;
  /** VS Code codicon name (check / circle-half-filled / warning / ...). */
  icon: string;
  features: IdeFeature[];
}

export const STATUS_GROUPS: ReadonlyArray<{ key: string; label: string; icon: string }> = [
  { key: 'complete', label: 'Complete', icon: 'check' },
  { key: 'partial', label: 'Partial', icon: 'circle-half-filled' },
  { key: 'present', label: 'Present', icon: 'circle-filled' },
  { key: 'missing', label: 'Missing', icon: 'warning' },
  { key: 'unknown', label: 'Unknown', icon: 'circle-outline' },
];

/** Primary health state of a feature (implementation dimension, explainable). */
export function featureHealthState(feature: IdeFeature): string {
  return feature.health?.implementation ?? 'unknown';
}

/** Group features by their primary health state; flat mode returns a single group. */
export function groupFeatures(features: IdeFeature[], mode: GroupMode): FeatureGroup[] {
  if (mode === 'flat') {
    return [{ key: 'all', label: 'All Features', icon: 'list-flat', features }];
  }
  const byState = new Map<string, IdeFeature[]>();
  for (const feature of features) {
    const state = featureHealthState(feature);
    byState.set(state, [...(byState.get(state) ?? []), feature]);
  }
  return STATUS_GROUPS.filter((group) => (byState.get(group.key)?.length ?? 0) > 0).map((group) => ({
    key: group.key,
    label: group.label,
    icon: group.icon,
    features: byState.get(group.key) ?? [],
  }));
}
