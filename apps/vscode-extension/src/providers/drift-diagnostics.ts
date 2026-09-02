/**
 * Drift diagnostics → VS Code Problems (v0.6.4 plan §37–§47).
 *
 * Only deterministic drift (relation_broken / new_candidate) becomes a
 * Problem; the pipeline supplies every location and the collection is
 * replaced (never appended) so resolved drift clears. The pure
 * conversion lives in `drift-map.ts`.
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeDriftReport } from '../client/featuremap-client';
import { mapDriftToDiagnostics } from './drift-map';

export interface DriftDiagnostics {
  refresh(): Promise<void>;
  dispose(): void;
}

export function registerDriftDiagnostics(
  repoRoot: string,
  client: () => FeatureMapClient | undefined,
): DriftDiagnostics {
  const collection = vscode.languages.createDiagnosticCollection('featuremap');
  return {
    async refresh() {
      const c = client();
      if (!c) {
        collection.clear();
        return;
      }
      try {
        const report = await c.request<IdeDriftReport>('diagnostics.drift');
        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const m of mapDriftToDiagnostics(report.issues)) {
          const severity =
            m.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
          const diagnostic = new vscode.Diagnostic(new vscode.Range(m.line, 0, m.line, 0), m.message, severity);
          diagnostic.source = 'FeatureMap';
          diagnostic.code = m.code;
          const list = byFile.get(m.filePath) ?? [];
          list.push(diagnostic);
          byFile.set(m.filePath, list);
        }
        // Replace, never append, so resolved drift is cleared (plan §43).
        collection.clear();
        for (const [filePath, diagnostics] of byFile) {
          collection.set(vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(repoRoot), filePath).fsPath), diagnostics);
        }
      } catch {
        collection.clear();
      }
    },
    dispose: () => collection.dispose(),
  };
}
