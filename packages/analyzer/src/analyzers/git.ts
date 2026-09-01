/**
 * Git analyzer plugin (docs/ANALYZER_PLUGIN_SPEC.md §3 — universal).
 *
 * Detection reports git availability; facts are collected separately
 * by collectGitInfo (git-info.ts) for persistence. Evidence emission
 * for change impact is Milestone 4 work (docs/DEVELOPMENT_PLAN.md).
 */
import type {
  AnalyzerPlugin,
  AnalyzerResult,
  AnalyzeContext,
  DetectContext,
  DetectionResult,
} from '@featuremap/plugin-sdk';
import { emptyResult } from '@featuremap/plugin-sdk';

export const gitAnalyzer: AnalyzerPlugin = {
  id: 'git',
  version: '0.1.0',

  detect(context: DetectContext): DetectionResult {
    const detected = context.files.length > 0;
    return { detected, confidence: detected ? 1.0 : 0 };
  },

  analyze(_context: AnalyzeContext): AnalyzerResult {
    const result = emptyResult();
    result.diagnostics.push({
      level: 'info',
      code: 'GIT_COLLECTED_SEPARATELY',
      message: 'Commit and change facts are collected by the scan orchestrator.',
    });
    return result;
  },
};
