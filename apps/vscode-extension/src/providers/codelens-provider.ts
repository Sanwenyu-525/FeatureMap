/**
 * CodeLens intelligence (v0.6.2 plan §8, Phase F).
 *
 * Precision over recall: only confirmed / high-confidence relations
 * reach a lens (the server filters via `code.documentIntelligence`).
 * One batch RPC per document — never N+1 per symbol.
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeDocumentSymbolFeature } from '../client/featuremap-client';

interface DocLensCache {
  version: number;
  lenses: vscode.CodeLens[];
}

export function registerCodeLensProvider(client: () => FeatureMapClient | undefined): vscode.Disposable {
  const cache = new Map<string, DocLensCache>();
  return vscode.languages.registerCodeLensProvider(
    { scheme: 'file' },
    {
      async provideCodeLenses(document): Promise<vscode.CodeLens[]> {
        const c = client();
        if (!c) return [];
        const filePath = document.uri.fsPath.replace(/\\/g, '/');
        const cached = cache.get(filePath);
        if (cached && cached.version === document.version) return cached.lenses;

        let rows: IdeDocumentSymbolFeature[] = [];
        try {
          rows = await c.request<IdeDocumentSymbolFeature[]>('code.documentIntelligence', { filePath });
        } catch {
          rows = [];
        }
        const lenses = rows.map((row) => {
          const line = row.symbol.startLine - 1;
          const range = new vscode.Range(line, 0, line, 0);
          const pct = Math.round(row.confidence * 100);
          return new vscode.CodeLens(range, {
            title: `FeatureMap: ${row.feature.name} · ${pct}%`,
            command: 'featuremap.showRelatedFeatures',
            arguments: [row.feature.id, { filePath, name: row.symbol.name, startLine: row.symbol.startLine }],
          });
        });
        cache.set(filePath, { version: document.version, lenses });
        return lenses;
      },
    },
  );
}
