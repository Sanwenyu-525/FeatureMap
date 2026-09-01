import type { FeaturePattern, FeatureStatus, InstructionLevel } from './entities.js';

/**
 * Explainable feature health (docs/MVP_SPEC.md §9, docs/DATA_MODEL.md §5).
 *
 * Never expose opaque completion percentages such as "87% complete";
 * derive health states from evidence instead. `present` applies to
 * evidence-bearing dimensions (tests, documentation) per MVP_SPEC §9.
 */
export type HealthState =
  | 'complete'
  | 'partial'
  | 'present'
  | 'missing'
  | 'unknown';

export interface FeatureHealth {
  implementation: HealthState;
  api: HealthState | 'not_applicable';
  tests: HealthState;
  documentation: HealthState;
  instructions: HealthState | 'not_applicable';
  documentationDrift: 'clear' | 'warning' | 'unknown';
}

export const DEFAULT_FEATURE_HEALTH: FeatureHealth = {
  implementation: 'unknown',
  api: 'not_applicable',
  tests: 'unknown',
  documentation: 'unknown',
  instructions: 'not_applicable',
  documentationDrift: 'unknown',
};

/**
 * Manual overrides have the highest authority (docs/DATA_MODEL.md §7).
 * Analyzer evidence must never be destroyed when an override exists.
 */
export type ManualOverrideAction =
  | 'add_relation'
  | 'remove_relation'
  | 'rename_feature'
  | 'merge_feature';

export interface ManualOverride {
  id: string;
  action: ManualOverrideAction;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type { FeaturePattern, FeatureStatus, InstructionLevel };
