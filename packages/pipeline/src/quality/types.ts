/**
 * Mapping benchmark contract (v0.7.1, Milestone 26 §Stage 0).
 *
 * Ground truth lives as a colocated `mapping.expected.json` in each
 * fixture. Targets use stable locators — `path` + symbol `name` — never
 * DB-generated ids, so the corpus survives rescans. `confidenceClass`
 * captures the multi-layer confidence model: some relations must reach
 * high-confidence surfaces, some only need to exist as suggestions, and
 * some must never be promoted (hard negatives).
 */

export const MAPPING_BENCHMARK_VERSION = 1;

export type BenchmarkRelation = 'OWNS' | 'DEPENDS_ON';

/** Which confidence surface the relation is allowed to reach. */
export type ConfidenceClass = 'must-high' | 'may-suggest' | 'must-not-high';

export interface BenchmarkTarget {
  type: 'file' | 'symbol';
  path: string;
  /** Bare or qualified symbol name (e.g. `login` / `AuthService.login`); required for symbols. */
  symbol?: string;
}

export interface ExpectedMapping {
  target: BenchmarkTarget;
  relation: BenchmarkRelation;
  confidenceClass?: ConfidenceClass;
  tags?: string[];
}

export interface BenchmarkFeature {
  /** Feature name or id (e.g. `login` or `feature:login`). */
  id: string;
  name?: string;
  /** Relations FeatureMap must discover. */
  expected: ExpectedMapping[];
  /** Curated hard negatives — relations that must NOT appear as strong mappings. */
  notExpected?: ExpectedMapping[];
}

export interface BenchmarkEntity {
  /** Shared-infrastructure entity the runner must not promote to ownership. */
  target: BenchmarkTarget;
  tags: string[];
}

export interface MappingBenchmarkSpec {
  version: typeof MAPPING_BENCHMARK_VERSION;
  features: BenchmarkFeature[];
  /** Shared-infra / cross-feature entities used by the suppression metrics. */
  entities?: BenchmarkEntity[];
}
