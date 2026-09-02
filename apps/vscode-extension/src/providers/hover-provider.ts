/**
 * Hover intelligence (v0.6.2 plan §7, Phase E).
 *
 * Hover = orientation: a compact, evidence-backed summary of the
 * symbol's owning feature, direct dependencies, related tests and
 * action links. Full exploration happens in the Related Features panel
 * and Explain Relation.
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeCodeIntelligence } from '../client/featuremap-client';
import { renderHoverMarkdownSource } from './hover-markdown';
import { resolveSymbolRef } from './position-symbol';

export function registerHoverProvider(client: () => FeatureMapClient | undefined): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    {
      async provideHover(document, position): Promise<vscode.Hover | undefined> {
        const c = client();
        if (!c) return undefined;
        const symbol = await resolveSymbolRef(document, position);
        try {
          const info = await c.request<IdeCodeIntelligence | null>('code.intelligence', { symbol });
          if (!info || !info.primaryFeature) return undefined;
          const markdown = new vscode.MarkdownString(renderHoverMarkdownSource(info));
          markdown.isTrusted = true;
          return new vscode.Hover(markdown);
        } catch {
          return undefined;
        }
      },
    },
  );
}
