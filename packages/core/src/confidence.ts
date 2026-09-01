/**
 * Confidence semantics from docs/DATA_MODEL.md §4 and AGENTS.md §6.
 *
 * | Confidence | Meaning                                            |
 * |------------|----------------------------------------------------|
 * | 1.00       | deterministic fact or explicit manual mapping      |
 * | 0.90–0.99  | very strong inference                              |
 * | 0.80–0.89  | strong inference                                   |
 * | 0.50–0.79  | uncertain but potentially useful                   |
 * | <0.50      | retain internally; do not present as confirmed     |
 */

export type ConfidenceBand =
  | 'deterministic'
  | 'very_strong'
  | 'strong'
  | 'uncertain'
  | 'below_threshold';

/** Confidence value at or above which a relation may be surfaced as confirmed. */
export const SURFACE_THRESHOLD = 0.5;

/** Default minimum confidence for impact traversal (docs/featuremap.example.yaml). */
export const DEFAULT_MINIMUM_IMPACT_CONFIDENCE = 0.65;

/**
 * Clamp a confidence value into the valid [0, 1] range.
 * Out-of-range inputs are coerced rather than trusted.
 */
export function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function classifyConfidence(value: number): ConfidenceBand {
  const c = clampConfidence(value);
  if (c < SURFACE_THRESHOLD) return 'below_threshold';
  if (c < 0.8) return 'uncertain';
  if (c < 0.9) return 'strong';
  if (c < 1) return 'very_strong';
  return 'deterministic';
}

/**
 * Whether a relation with this confidence may be surfaced to users as a
 * normal confirmed relation. Below-threshold evidence stays internal.
 */
export function isSurfaceable(value: number): boolean {
  return classifyConfidence(value) !== 'below_threshold';
}

/**
 * Display label per docs/FEATURE_VISUALIZATION.md §6:
 * low-confidence inferred mappings must be visually distinguishable
 * from deterministic relations.
 */
export function confidenceLabel(value: number): 'Confirmed' | 'Inferred' | 'Uncertain' {
  const band = classifyConfidence(value);
  switch (band) {
    case 'deterministic':
      return 'Confirmed';
    case 'very_strong':
    case 'strong':
      return 'Inferred';
    case 'uncertain':
    case 'below_threshold':
      return 'Uncertain';
  }
}
