/**
 * Analyzer plugin contracts — docs/ANALYZER_PLUGIN_SPEC.md.
 *
 * A plugin detects a technology and emits normalized Evidence. Plugins
 * must never write UI-specific structures and must isolate their own
 * failures as diagnostics (AGENTS.md §3.1, §3.5).
 */
import type { CodeAssetType, EntityType, RelationType } from '@featuremap/core';

/** A file entry produced by the scanner (POSIX-style repo-relative path). */
export interface ScannedFile {
  path: string;
  hash: string;
  language?: string;
  size: number;
}

export interface DetectContext {
  repoRoot: string;
  files: ScannedFile[];
  readFile: (path: string) => string | undefined;
}

export interface DetectionResult {
  detected: boolean;
  /** Semantics per docs/DATA_MODEL.md §4. */
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface AnalyzeContext extends DetectContext {
  /** Only files passing config ignore rules are provided. */
  config: {
    analyzers: string[];
    scan: { baseBranch: string; ignore: string[] };
  };
}

/** Asset produced by an analyzer; ids are assigned by the platform. */
export interface CodeAssetInput {
  type: CodeAssetType;
  path?: string;
  name?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Evidence produced by an analyzer; ids are assigned by the platform.
 * Deterministic findings must use confidence 1.0 (docs/DATA_MODEL.md §4).
 */
export interface EvidenceInput {
  sourceType: EntityType;
  sourceId: string;
  relationType: RelationType;
  targetType: EntityType;
  targetId: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface AnalyzerDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
}

export interface AnalyzerResult {
  assets: CodeAssetInput[];
  evidence: EvidenceInput[];
  diagnostics: AnalyzerDiagnostic[];
}

/** Minimal analyzer interface (docs/ANALYZER_PLUGIN_SPEC.md §2). */
export interface AnalyzerPlugin {
  id: string;
  version: string;

  detect(context: DetectContext): Promise<DetectionResult> | DetectionResult;

  analyze(context: AnalyzeContext): Promise<AnalyzerResult> | AnalyzerResult;
}

export const emptyResult = (): AnalyzerResult => ({
  assets: [],
  evidence: [],
  diagnostics: [],
});
