/**
 * Context UX commands (v0.6.5 plan §27–§71, §81–§87).
 *
 * Build / Copy / Preview / Save / Recommended Files are all consumers of
 * the single read-only `context.build` result. This module only adapts:
 * Clipboard, workspace.fs and navigation are VS Code concerns; the
 * extension never re-assembles or re-trims the context.
 */
import * as vscode from 'vscode';
import type {
  FeatureMapClient,
  IdeContextDocument,
  IdeFeature,
  IdeRecommendedFile,
  IdeRelatedFeaturesResult,
} from '../client/featuremap-client';
import { resolveSymbolRef } from './position-symbol';
import { CONTEXT_SCHEME, FeatureMapContextDocumentProvider } from './context-provider';
import { isSafeArtifactPath } from './context-path';

export interface ContextUxDeps {
  getClient(): FeatureMapClient | undefined;
  repoRoot(): string | undefined;
}

export function registerContextUx(
  context: vscode.ExtensionContext,
  deps: ContextUxDeps,
): FeatureMapContextDocumentProvider {
  const provider = new FeatureMapContextDocumentProvider();
  context.subscriptions.push(provider, vscode.workspace.registerTextDocumentContentProvider(CONTEXT_SCHEME, provider));

  async function build(featureId: string, task?: string): Promise<{ uri: vscode.Uri; result: IdeContextDocument } | undefined> {
    const c = deps.getClient();
    const root = deps.repoRoot();
    if (!c || !root) return undefined;
    try {
      const result = await c.request<IdeContextDocument>('context.build', { featureId, task });
      const uri = provider.set({ repoRoot: root, result });
      return { uri, result };
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  async function openPreview(featureId: string, task?: string): Promise<void> {
    const built = await build(featureId, task);
    if (!built) return;
    const doc = await vscode.workspace.openTextDocument(built.uri);
    await vscode.window.showTextDocument(doc, { preview: true });
    await vscode.commands.executeCommand('markdown.showPreviewToSide', built.uri);
  }

  function currentContextUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri?.scheme === CONTEXT_SCHEME) return uri;
    const active = vscode.window.activeTextEditor?.document.uri;
    return active?.scheme === CONTEXT_SCHEME ? active : undefined;
  }

  function flash(message: string): void {
    void vscode.window.setStatusBarMessage(message, 1500);
  }

  // ---- Save (plan §51–§57, §64–§71) ---------------------------------

  async function saveCurrentContext(uri?: vscode.Uri): Promise<void> {
    const target = currentContextUri(uri);
    const state = target ? provider.get(target) : undefined;
    if (!state) return;
    const rel = state.result.artifact.relativePath;
    if (!isSafeArtifactPath(rel)) {
      void vscode.window.showErrorMessage(`FeatureMap: refusing to save outside .featuremap/context (${rel}).`);
      return;
    }
    const root = vscode.Uri.file(state.repoRoot);
    const dir = vscode.Uri.joinPath(root, '.featuremap', 'context');
    try {
      await vscode.workspace.fs.createDirectory(dir);
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, rel), Buffer.from(state.result.markdown, 'utf8'));
      flash(`FeatureMap: context saved → ${rel}`);
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Recommended Files (plan §58–§65, §81–§87) ---------------------

  async function openRecommendedFile(file: IdeRecommendedFile): Promise<void> {
    const root = deps.repoRoot();
    if (!root) return;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.Uri.file(root), file.path).fsPath);
      const editor = await vscode.window.showTextDocument(doc);
      if (file.location?.startLine) {
        const pos = new vscode.Position(file.location.startLine - 1, 0); // 1-based → 0-based at the adapter
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
      }
    } catch {
      void vscode.window.showInformationMessage('FeatureMap: the recommended file no longer exists — rebuild the context.');
    }
  }

  async function openRecommendedFiles(uri?: vscode.Uri): Promise<void> {
    const target = currentContextUri(uri);
    const state = target ? provider.get(target) : undefined;
    if (!state) return;
    const files = state.result.recommendedFiles;
    if (files.length === 0) {
      void vscode.window.showInformationMessage('FeatureMap: no recommended files in this context.');
      return;
    }
    // Strict server order (plan §83); the extension never re-ranks.
    const pick = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: f.path,
        description: f.roles.join(' · '),
        detail: (f.symbols ?? []).map((s) => s.name).join(', '),
        file: f,
      })),
      { placeHolder: 'Recommended Files' },
    );
    if (pick) await openRecommendedFile(pick.file);
  }

  // ---- Rebuild (plan §48, §66) ---------------------------------------

  async function rebuildCurrentContext(uri?: vscode.Uri): Promise<void> {
    const target = currentContextUri(uri);
    if (!target) return;
    const state = provider.get(target);
    if (!state) return;
    const { result } = state;
    const rebuilt = await build(result.feature.id, result.task);
    if (!rebuilt) return;
    provider.update(target, rebuilt.result);
    flash('FeatureMap: context rebuilt');
  }

  // ---- Task Context (plan §38–§63) -----------------------------------

  async function buildTaskContext(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const c = deps.getClient();
    if (!editor || !c) return;
    const root = deps.repoRoot();
    if (!root) return;
    const symbolRef = await resolveSymbolRef(editor.document, editor.selection.active);
    let related: IdeRelatedFeaturesResult['features'] = [];
    if (symbolRef) {
      try {
        related = (await c.request<IdeRelatedFeaturesResult>('code.relatedFeatures', { symbol: symbolRef })).features;
      } catch {
        related = [];
      }
    }
    let featureId: string | undefined;
    if (related.length === 0) {
      // Fallback: let the user pick from all features (plan §45).
      const list = (await c.request<IdeFeature[]>('features.list')) as IdeFeature[];
      const pick = await vscode.window.showQuickPick(
        list.map((f) => ({ label: f.name, detail: f.id, featureId: f.id })),
        { placeHolder: 'No Feature was mapped to the current code. Select a Feature manually.' },
      );
      featureId = pick?.featureId;
    } else if (related.length === 1) {
      featureId = related[0]!.featureId;
    } else {
      // Multiple candidates → human chooses the primary Feature (plan §56).
      const pick = await vscode.window.showQuickPick(
        related.map((f) => ({
          label: f.name,
          description: `${f.relation.type} · ${f.relation.status} ${Math.round(f.relation.confidence * 100)}%`,
          featureId: f.featureId,
        })),
        { placeHolder: 'Select Feature for Task Context' },
      );
      featureId = pick?.featureId;
    }
    if (!featureId) return;
    const task = await vscode.window.showInputBox({
      title: 'Build Task Context',
      prompt: 'Describe the task',
      placeHolder: 'Add refresh token rotation and update relevant tests',
      validateInput: (value) => (value.trim().length > 0 ? undefined : 'Enter a task description'),
    });
    if (task === undefined) return; // Esc → cancel
    await openPreview(featureId, task.trim());
  }

  // ---- Command registration ------------------------------------------

  context.subscriptions.push(
    vscode.commands.registerCommand('featuremap.buildFeatureContext', (featureId?: string) => {
      if (featureId) void openPreview(featureId);
    }),
    vscode.commands.registerCommand('featuremap.copyAgentContext', async (featureId?: string) => {
      if (!featureId) return;
      const built = await build(featureId);
      if (!built) return;
      await vscode.env.clipboard.writeText(built.result.markdown); // verbatim, no prepend/append (plan §30)
      flash('FeatureMap: context copied');
    }),
    vscode.commands.registerCommand('featuremap.buildTaskContext', buildTaskContext),
    vscode.commands.registerCommand('featuremap.copyCurrentContext', async (uri?: vscode.Uri) => {
      const target = currentContextUri(uri);
      const state = target ? provider.get(target) : undefined;
      if (!state) return;
      await vscode.env.clipboard.writeText(state.result.markdown);
      flash('FeatureMap: context copied');
    }),
    vscode.commands.registerCommand('featuremap.saveCurrentContext', (uri?: vscode.Uri) => saveCurrentContext(uri)),
    vscode.commands.registerCommand('featuremap.openRecommendedFiles', (uri?: vscode.Uri) => openRecommendedFiles(uri)),
    vscode.commands.registerCommand('featuremap.rebuildCurrentContext', (uri?: vscode.Uri) => rebuildCurrentContext(uri)),
    vscode.commands.registerCommand('featuremap.openRecommendedFile', (file?: IdeRecommendedFile) => {
      if (file) void openRecommendedFile(file);
    }),
  );

  return provider;
}
