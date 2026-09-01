/**
 * Analyzer platform (docs/ARCHITECTURE.md §2.2).
 *
 * Responsibilities: execute analyzer plugins, normalize output, isolate
 * failures, and attach analyzer identity to every emitted record.
 */
import { createHash } from 'node:crypto';
import type {
  AnalyzerDiagnostic,
  AnalyzerPlugin,
  AnalyzeContext,
  CodeAssetInput,
  DetectionResult,
  EvidenceInput,
  ScannedFile,
} from '@featuremap/plugin-sdk';

export type { AnalyzerDiagnostic, CodeAssetInput, EvidenceInput, ScannedFile };

export interface PlatformAsset extends CodeAssetInput {
  id: string;
  analyzerId: string;
}

export interface PlatformEvidence extends EvidenceInput {
  id: string;
  analyzerId: string;
}

export interface AnalyzerRunSummary {
  analyzerId: string;
  version: string;
  status: 'ok' | 'degraded' | 'failed' | 'skipped';
  assetCount: number;
  evidenceCount: number;
  diagnostics: AnalyzerDiagnostic[];
}

export interface PlatformOutput {
  assets: PlatformAsset[];
  evidence: PlatformEvidence[];
  runs: AnalyzerRunSummary[];
}

/** Deterministic asset id: stable across scans for identical inputs. */
export function assetId(input: CodeAssetInput): string {
  const key = JSON.stringify([input.type, input.path ?? '', input.name ?? '']);
  return `a_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

/** Deterministic evidence id: stable across scans for identical inputs. */
export function evidenceId(input: EvidenceInput & { analyzerId: string }): string {
  const key = JSON.stringify([
    input.sourceType,
    input.sourceId,
    input.relationType,
    input.targetType,
    input.targetId,
    input.analyzerId,
  ]);
  return `e_${createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

/**
 * Register one file asset per scanned file. The platform owns file
 * assets so individual analyzers never duplicate them.
 */
function toFileAssets(files: ScannedFile[]): PlatformAsset[] {
  return files.map((f) => {
    const input: CodeAssetInput = {
      type: 'file',
      path: f.path,
      language: f.language,
      metadata: { size: f.size, hash: f.hash },
    };
    return { ...input, id: assetId(input), analyzerId: 'platform' };
  });
}

/**
 * Run detection for each plugin, then analysis for detected plugins.
 * A plugin failure is isolated into its run summary and never aborts
 * the platform (AGENTS.md §3.5).
 */
export async function runAnalyzers(
  plugins: AnalyzerPlugin[],
  context: AnalyzeContext,
  files: ScannedFile[],
): Promise<PlatformOutput> {
  const output: PlatformOutput = {
    assets: toFileAssets(files),
    evidence: [],
    runs: [],
  };

  for (const plugin of plugins) {
    const run: AnalyzerRunSummary = {
      analyzerId: plugin.id,
      version: plugin.version,
      status: 'ok',
      assetCount: 0,
      evidenceCount: 0,
      diagnostics: [],
    };
    try {
      const detection: DetectionResult = await plugin.detect(context);
      if (!detection.detected) {
        run.status = 'skipped';
        run.diagnostics.push({
          level: 'info',
          code: 'NOT_DETECTED',
          message: `${plugin.id} not detected in repository`,
        });
        output.runs.push(run);
        continue;
      }
      const result = await plugin.analyze(context);
      run.assetCount = result.assets.length;
      run.evidenceCount = result.evidence.length;
      run.diagnostics = result.diagnostics;
      if (result.diagnostics.some((d) => d.level === 'error')) run.status = 'degraded';

      for (const asset of result.assets) {
        output.assets.push({ ...asset, id: assetId(asset), analyzerId: plugin.id });
      }
      for (const ev of result.evidence) {
        const withAnalyzer = { ...ev, analyzerId: plugin.id };
        output.evidence.push({ ...withAnalyzer, id: evidenceId(withAnalyzer) });
      }
    } catch (err) {
      run.status = 'failed';
      run.diagnostics.push({
        level: 'error',
        code: 'ANALYZER_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    output.runs.push(run);
  }

  return output;
}
