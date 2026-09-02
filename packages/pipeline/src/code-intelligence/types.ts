/**
 * Code Intelligence domain types (Phase 6 / v0.6.2).
 *
 * Editor positions are the entry point, so a `SymbolRef` (file + name +
 * range) is the primary input, never a raw database symbol id. Line
 * numbers are 1-based across the FeatureMap RPC/domain boundary; the
 * VS Code adapter converts 0-based Positions at its edge (ADR-0008).
 */
import type { FeaturePattern } from '@featuremap/core';

/** 1-based editor position / stored-symbol hint. */
export interface SymbolRef {
  filePath: string;
  name?: string;
  startLine?: number;
  endLine?: number;
}

export interface ResolvedSymbol {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Canonical Feature relations. Code-graph edges (CALLS / REFERENCES /
 * CONTAINS) are evidence types, never promoted to Feature relations
 * directly (plan §A4: Feature relation and evidence relation stay
 * layered).
 */
export type FeatureRelationType = 'OWNS' | 'DEPENDS_ON';

export type FeatureRelationStatus = 'confirmed' | 'declared' | 'accepted' | 'suggested';

export interface RelatedFeature {
  featureId: string;
  name: string;
  description?: string;
  pattern: FeaturePattern;
  relation: {
    type: FeatureRelationType;
    status: FeatureRelationStatus;
    confidence: number;
  };
  evidence: {
    available: boolean;
    count: number;
  };
}

export interface RelatedFeaturesResult {
  symbol: ResolvedSymbol;
  features: RelatedFeature[];
}

export interface RelatedFeaturesOptions {
  /** Include high-confidence suggested relations (default true). */
  includeSuggested?: boolean;
  /** Minimum confidence for suggested relations (default HIGH_CONFIDENCE_THRESHOLD). */
  minConfidence?: number;
  limit?: number;
}
