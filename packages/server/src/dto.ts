/**
 * Consumer DTOs — docs/API_SPEC.md.
 *
 * APIs return consumer-oriented DTOs, not raw database rows. Evidence
 * and confidence are preserved where relevant.
 */
import type { FeatureHealth, HealthState } from '@featuremap/core';

export interface TechnologyDetectionDto {
  id: string;
  confidence: number;
  source: string;
}

/** GET /project */
export interface ProjectResponse {
  name: string;
  root: string;
  baseBranch: string;
  currentBranch?: string;
  technologies: TechnologyDetectionDto[];
  lastScan?: string;
}

/** GET /overview */
export interface FeatureHealthSummary {
  total: number;
  byState: Record<HealthState, number>;
}

export interface ImpactSummary {
  changedFiles: number;
  affectedFeatures: number;
}

export interface OverviewCounts {
  features: number;
  files: number;
  endpoints: number;
  tests: number;
  documents: number;
  instructions: number;
}

export interface OverviewResponse {
  counts: OverviewCounts;
  health: FeatureHealthSummary;
  currentImpact: ImpactSummary;
}

/** GET /features */
export interface FeatureListItemDto {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
  status: string;
  health?: FeatureHealth;
  updatedAt: string;
}

/** GET /features/:id — full Feature Detail context (docs/MVP_SPEC.md §7.3). */
export interface FeatureDetailDto extends FeatureListItemDto {
  parentId?: string;
  assets: Array<{ id: string; type: string; path?: string; name?: string }>;
  documents: Array<{ path: string; title?: string }>;
  candidates: CandidateDto[];
  evidence: Array<{
    id: string;
    relationType: string;
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    confidence: number;
    analyzerId: string;
  }>;
}

/** Candidate feature↔code relation with review state (Milestone 8). */
export interface CandidateDto {
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  relation: 'owns' | 'DEPENDS_ON';
  status: 'declared' | 'suggested' | 'accepted' | 'rejected' | 'superseded';
  score: number;
  distance: number;
  fanIn: number;
  evidenceChain: Array<{
    relationType: string;
    sourceId: string;
    targetId: string;
    confidence: number;
  }>;
}

/** POST /features/:id/candidates/verdict */
export interface VerdictRequest {
  targetId: string;
  verdict: 'accepted' | 'rejected';
}

/** GET /changes */
export interface ChangesResponse {
  currentBranch?: string;
  baseBranch: string;
  changedFiles: Array<{ path: string; changeType: string; commitSha: string }>;
  affectedFeatures: Array<{
    featureId: string;
    featureName: string;
    confidence: number;
    reasons: string[];
  }>;
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
}

/** POST /scan */
export interface ScanRequest {
  mode: 'incremental' | 'full';
}

/** GET /analyzers */
export interface AnalyzerStatusDto {
  analyzerId: string;
  version: string;
  status: 'ok' | 'degraded' | 'failed';
  diagnostics: Array<{ level: string; code: string; message: string; path?: string }>;
}

/** Stable machine-readable error envelope (docs/API_SPEC.md §4). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ERROR_CODES = [
  'PROJECT_NOT_INITIALIZED',
  'SCAN_FAILED',
  'FEATURE_NOT_FOUND',
  'CANDIDATE_NOT_FOUND',
  'AMBIGUOUS_TARGET',
  'ANCHOR_NOT_REVIEWABLE',
  'INVALID_CONFIG',
  'GIT_UNAVAILABLE',
  'ANALYZER_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
