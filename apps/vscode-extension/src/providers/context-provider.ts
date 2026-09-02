/**
 * Context Preview provider (v0.6.5 plan §32–§49).
 *
 * `featuremap-context:` virtual documents backed by a UI cache of
 * `context.build` results — a snapshot, never a live dashboard. The
 * provider never calls the context builder; Preview / Copy / Save /
 * Recommended Files all read the cached projection (plan §44).
 */
import * as vscode from 'vscode';
import type { IdeContextDocument } from '../client/featuremap-client';

export const CONTEXT_SCHEME = 'featuremap-context';

export interface ContextPreviewState {
  repoRoot: string;
  result: IdeContextDocument;
}

export class FeatureMapContextDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly states = new Map<string, ContextPreviewState>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  /** URI whose identity is the deterministic contextId (plan §42). */
  uriFor(result: IdeContextDocument): vscode.Uri {
    return vscode.Uri.parse(`${CONTEXT_SCHEME}:/${result.contextId}.md`);
  }

  set(state: ContextPreviewState): vscode.Uri {
    const uri = this.uriFor(state.result);
    this.states.set(uri.toString(), state);
    return uri;
  }

  get(uri: vscode.Uri): ContextPreviewState | undefined {
    return this.states.get(uri.toString());
  }

  /** Replace the cached projection and refresh the open document (plan §48). */
  update(uri: vscode.Uri, result: IdeContextDocument): void {
    const prev = this.states.get(uri.toString());
    if (!prev) return;
    this.states.set(uri.toString(), { ...prev, result });
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.states.get(uri.toString())?.result.markdown ?? '';
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.states.clear();
  }
}
