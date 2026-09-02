/**
 * Code Intelligence confidence policy (v0.6.2 plan §16).
 *
 * Thresholds live in the pipeline, never scattered across the
 * extension. Initial values are tuned by the CodeLens false-positive
 * benchmark; they are not user-facing configuration in v0.6.2.
 */
export const CODE_INTELLIGENCE_POLICY = {
  hoverMinConfidence: 0.85,
  codeLensMinConfidence: 0.9,
  relatedFeaturesMinConfidence: 0.8,
  maxHoverFeatures: 2,
  maxHoverDependencies: 3,
  maxHoverTests: 2,
  /**
   * Fan-in at/above which a DEPENDS_ON relation is treated as shared
   * infrastructure and requires a higher score to enter Hover/CodeLens
   * (plan §15; driven by graph metrics, never hardcoded names).
   */
  highFanInThreshold: 8,
  defaultRelatedLimit: 5,
} as const;
