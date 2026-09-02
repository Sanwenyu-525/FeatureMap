/**
 * FeatureMap VS Code extension entry (Phase 6 / ADR-0008).
 *
 * The extension is a pure adapter: it spawns the headless
 * `featuremap ide` service per workspace, drives a status bar item,
 * the Feature Explorer tree, and a minimal set of commands. No
 * analysis logic lives here (ADR-0008 §2).
 */
import * as vscode from 'vscode';
import { basename, join } from 'node:path';
import {
  spawnFeatureMapService,
  type FeatureMapClient,
  type IdeDriftReport,
  type IdeExplainRelation,
  type IdeFeature,
  type IdeFeatureDetail,
  type IdeImpactRefreshResult,
  type IdeProjectStatus,
  type IdeRelatedFeaturesResult,
  type IdeReviewExplain,
  type IdeReviewVerdictResult,
  type IdeSuggestedRelation,
  type IdeSymbolRef,
} from './client/featuremap-client';
import { FeatureTreeProvider } from './providers/feature-tree-provider';
import { registerHoverProvider } from './providers/hover-provider';
import { registerCodeLensProvider } from './providers/codelens-provider';
import { resolveSymbolRef } from './providers/position-symbol';
import { ImpactRefreshScheduler } from './providers/save-adapter';
import { ImpactTreeProvider } from './providers/impact-tree-provider';
import { registerDriftDiagnostics } from './providers/drift-diagnostics';
import { registerContextUx } from './providers/context-ux';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.name = 'FeatureMap';
  context.subscriptions.push(statusBar);

  let client: FeatureMapClient | undefined;

  const repoRoot = (): string | undefined => workspaceFolder?.uri.fsPath;
  const getClient = (): FeatureMapClient | undefined => client;

  async function connect(): Promise<FeatureMapClient | undefined> {
    if (client) return client;
    const root = repoRoot();
    if (!root) {
      statusBar.text = 'FeatureMap';
      statusBar.show();
      return undefined;
    }
    try {
      const spawned = spawnFeatureMapService({ repoRoot: root });
      spawned.onExit(() => {
        client = undefined;
        statusBar.text = 'FeatureMap: service exited';
        statusBar.show();
      });
      client = spawned;
      return spawned;
    } catch (err) {
      statusBar.text = 'FeatureMap: failed to start';
      statusBar.show();
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  async function refreshStatus(): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      const status = await c.request<IdeProjectStatus>('project.status');
      if (!status.initialized) {
        statusBar.text = '$(alert) FeatureMap: Initialize & Scan';
        statusBar.command = 'featuremap.initializeAndScan';
        statusBar.tooltip = 'FeatureMap is not initialized for this repository. Click to initialize and scan.';
      } else if (!status.scanned) {
        statusBar.text = '$(sync) FeatureMap: Scan';
        statusBar.command = 'featuremap.initializeAndScan';
        statusBar.tooltip = 'FeatureMap has no scan yet. Click to scan.';
      } else {
        statusBar.text = '$(check) FeatureMap';
        statusBar.command = 'featuremap.showFeatures';
        statusBar.tooltip = `FeatureMap · ${status.featureCount} features · last scan ${status.lastScanAt ?? 'unknown'}`;
      }
      await vscode.commands.executeCommand('setContext', 'featuremap.connected', true);
    } catch (err) {
      statusBar.text = '$(error) FeatureMap: unavailable';
      statusBar.tooltip = err instanceof Error ? err.message : String(err);
      await vscode.commands.executeCommand('setContext', 'featuremap.connected', false);
    }
    statusBar.show();
  }

  async function initializeAndScan(): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      statusBar.text = '$(sync~spin) FeatureMap: initializing…';
      statusBar.show();
      await c.request('init.run');
      statusBar.text = '$(sync~spin) FeatureMap: scanning…';
      statusBar.show();
      await c.request('scan.run', { mode: 'incremental' });
      await treeProvider.load();
      await refreshStatus();
    } catch (err) {
      statusBar.text = '$(error) FeatureMap: scan failed';
      statusBar.show();
      void vscode.window.showErrorMessage(`FeatureMap scan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function openFeature(featureId?: string): Promise<void> {
    if (!featureId) return;
    const c = await connect();
    const root = repoRoot();
    if (!c || !root) return;
    try {
      const detail = await c.request<IdeFeatureDetail>('features.get', { featureId });
      if (detail.assets.length === 0) {
        void vscode.window.showInformationMessage(`Feature ${detail.name} has no navigable code assets.`);
        return;
      }
      const picks = detail.assets.map((asset) => ({
        label: asset.name ?? (asset.path ? basename(asset.path) : asset.id),
        description: asset.type,
        detail: asset.path,
        asset,
      }));
      const chosen = await vscode.window.showQuickPick(picks, {
        placeHolder: `Open core code of ${detail.name} (${featureId})`,
      });
      if (chosen?.asset?.path) {
        const uri = vscode.Uri.file(join(root, chosen.asset.path));
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        // Feature → Symbol → source: reveal the symbol's line range (v0.6.1).
        const loc = chosen.asset.location;
        if (loc && loc.startLine > 0 && editor) {
          const start = new vscode.Position(loc.startLine - 1, 0);
          const end = new vscode.Position(Math.max(loc.startLine, loc.endLine) - 1, 0);
          const range = new vscode.Range(start, end);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
          editor.selection = new vscode.Selection(start, start);
        }
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function searchFeatures(): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      const features = await c.request<IdeFeature[]>('features.list');
      const pick = await vscode.window.showQuickPick(
        features.map((feature) => ({
          label: feature.name,
          description: feature.pattern,
          detail: feature.description,
          feature,
        })),
        {
          placeHolder: 'Search features (name / description / pattern)',
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      if (pick) await openFeature(pick.feature.id);
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function toggleGrouping(): void {
    treeProvider.setMode(treeProvider.getMode() === 'status' ? 'flat' : 'status');
    const label = treeProvider.getMode() === 'status' ? 'grouped by status' : 'flat list';
    void vscode.window.setStatusBarMessage(`FeatureMap: features ${label}`, 2000);
  }

  async function showRelatedFeatures(symbolRef?: IdeSymbolRef): Promise<void> {
    const c = await connect();
    if (!c) return;
    let ref = symbolRef;
    if (!ref) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      ref = await resolveSymbolRef(editor.document, editor.selection.active);
    }
    try {
      const result = await c.request<IdeRelatedFeaturesResult | null>('code.relatedFeatures', { symbol: ref });
      if (!result || result.features.length === 0) {
        void vscode.window.showInformationMessage('FeatureMap: no related features for this symbol.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        result.features.map((feature) => ({
          label: feature.name,
          description: `${feature.relation.type} · ${Math.round(feature.relation.confidence * 100)}%`,
          detail: `${feature.relation.status} — ${feature.pattern}`,
          feature,
        })),
        { placeHolder: `Related features of ${result.symbol.name}` },
      );
      if (pick) await openFeature(pick.feature.featureId);
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function explainRelation(featureId?: string, symbolId?: string): Promise<void> {
    const c = await connect();
    if (!c || !featureId || !symbolId) return;
    try {
      const exp = await c.request<IdeExplainRelation>('code.explainRelation', {
        featureId,
        target: { id: symbolId },
      });
      const items = [
        {
          label: `$(symbol-method) ${exp.targetId}`,
          description: `${exp.relation.toUpperCase()} · ${Math.round(exp.confidence * 100)}%`,
          detail: `status: ${exp.status}`,
        },
        ...exp.chain.slice(0, 10).map((step, i) => ({
          label: `${i + 1}. ${step.sourceId}`,
          description: step.relationType,
          detail: `→ ${step.targetId} (${Math.round(step.confidence * 100)}%)`,
        })),
      ];
      await vscode.window.showQuickPick(items, {
        placeHolder: `Why ${symbolId} belongs to ${featureId}`,
        matchOnDescription: true,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const impactTreeProvider = new ImpactTreeProvider(getClient);
  const impactView = vscode.window.createTreeView('featuremap.impact', { treeDataProvider: impactTreeProvider });
  context.subscriptions.push(impactView);

  async function refreshImpact(files: string[], trigger: 'save' | 'manual'): Promise<void> {
    const c = await connect();
    if (!c) return;
    statusBar.text = '$(sync~spin) FeatureMap: analyzing…';
    statusBar.command = 'featuremap.showCurrentImpact';
    statusBar.show();
    try {
      const result = await c.request<IdeImpactRefreshResult>('impact.refresh', { savedFiles: files, trigger });
      const n = result.snapshot.summary.affectedFeatureCount;
      statusBar.text = n > 0 ? `$(check) FeatureMap · ${n} affected` : '$(check) FeatureMap';
      statusBar.command = 'featuremap.showCurrentImpact';
      statusBar.tooltip = `Impact refreshed at ${result.snapshot.refreshedAt}`;
      await impactTreeProvider.load();
      await refreshDrift();
    } catch (err) {
      statusBar.text = '$(error) FeatureMap: impact unavailable';
      statusBar.tooltip = err instanceof Error ? err.message : String(err);
    }
    statusBar.show();
  }

  const impactScheduler = new ImpactRefreshScheduler((files) => refreshImpact(files, 'save'));
  context.subscriptions.push({ dispose: () => impactScheduler.dispose() });

  // Drift diagnostics + drift status bar (v0.6.4).
  const driftDiagnostics = registerDriftDiagnostics(repoRoot() ?? '', getClient);
  context.subscriptions.push({ dispose: () => driftDiagnostics.dispose() });
  const driftStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  driftStatusBar.name = 'FeatureMap Drift';
  context.subscriptions.push(driftStatusBar);

  function applyDriftStatus(report: IdeDriftReport): void {
    const n = report.summary.issueCount;
    if (n > 0) {
      driftStatusBar.text = `$(warning) FeatureMap ⚠ ${n} issue${n > 1 ? 's' : ''}`;
      driftStatusBar.command = 'workbench.action.problems.focus';
      driftStatusBar.tooltip = `${n} drift issue(s) — click to open Problems.`;
      driftStatusBar.show();
    } else {
      driftStatusBar.hide();
    }
  }

  async function refreshDrift(): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      const report = await c.request<IdeDriftReport>('diagnostics.drift');
      await driftDiagnostics.refresh();
      applyDriftStatus(report);
    } catch {
      driftStatusBar.hide();
      driftDiagnostics.refresh();
    }
  }

  // Save-triggered impact (v0.6.3 plan §8/§9): aggregate saves, never
  // per-keystroke, never scan.run from the extension.
  const saveSubscription = vscode.workspace.onDidSaveTextDocument((document) => {
    const root = repoRoot();
    if (!root || document.uri.scheme !== 'file') return;
    const abs = document.uri.fsPath;
    if (!abs.startsWith(root)) return;
    const rel = abs.slice(root.length).replace(/\\/g, '/').replace(/^\//, '');
    if (rel.startsWith('node_modules/') || rel.startsWith('.git/') || rel.startsWith('.featuremap/')) return;
    impactScheduler.push(rel);
  });
  context.subscriptions.push(saveSubscription);

  function openImpactFile(path?: string): void {
    const root = repoRoot();
    if (!root || !path) return;
    void vscode.workspace
      .openTextDocument(vscode.Uri.file(join(root, path)))
      .then((doc) => vscode.window.showTextDocument(doc));
  }

  // ---- Review workflow (v0.6.4 plan §25–§36) -------------------------

  async function openSuggestionTarget(suggestion: IdeSuggestedRelation): Promise<void> {
    const root = repoRoot();
    const loc = suggestion.target.location;
    if (!root || !loc) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(join(root, loc.filePath)));
    const editor = await vscode.window.showTextDocument(doc);
    if (loc.startLine > 0) {
      const pos = new vscode.Position(loc.startLine - 1, 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(pos, pos);
    }
  }

  async function explainSuggestion(suggestion: IdeSuggestedRelation): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      const exp = await c.request<IdeReviewExplain>('review.explain', {
        featureId: suggestion.feature.id,
        target: { type: suggestion.target.type, id: suggestion.target.id },
      });
      const items = [
        {
          label: `${exp.feature.name} — ${exp.relation} ${exp.target.label}`,
          description: `Score ${Math.round(exp.score * 100)}%`,
          detail: `status: ${exp.status}`,
        },
        ...exp.evidenceChain.slice(0, 10).map((step, i) => ({
          label: `${i + 1}. ${step.sourceId}`,
          description: step.relationType,
          detail: `→ ${step.targetId} (${Math.round(step.confidence * 100)}%)`,
        })),
      ];
      await vscode.window.showQuickPick(items, {
        placeHolder: `Why ${exp.target.label} belongs to ${exp.feature.name}`,
        matchOnDescription: true,
      });
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function applySuggestionVerdict(suggestion: IdeSuggestedRelation, verdict: 'accepted' | 'rejected'): Promise<boolean> {
    const c = await connect();
    if (!c) return false;
    try {
      const result = await c.request<IdeReviewVerdictResult>('review.verdict', {
        featureId: suggestion.feature.id,
        target: { type: suggestion.target.type, id: suggestion.target.id },
        verdict,
        expectedFingerprint: suggestion.fingerprint,
      });
      if (!result.applied) {
        void vscode.window.showInformationMessage(
          `FeatureMap: candidate changed since it was listed — refreshed the Review inbox.`,
        );
        await treeProvider.load();
        return false;
      }
      // Verdict applied: refresh Explorer, CodeLens, diagnostics, drift status.
      await treeProvider.load();
      await refreshDrift();
      return true;
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async function reviewSuggestions(): Promise<void> {
    const c = await connect();
    if (!c) return;
    try {
      const suggestions = await c.request<IdeSuggestedRelation[]>('suggestions.list');
      if (suggestions.length === 0) {
        void vscode.window.showInformationMessage('FeatureMap: no suggested relations to review.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        suggestions.map((s) => ({
          label: `${s.feature.name} → ${s.target.label}`,
          description: `${s.relation} · ${Math.round(s.score * 100)}%`,
          detail: s.target.type,
          suggestion: s,
        })),
        { placeHolder: 'Review suggested relations' },
      );
      if (!pick) return;
      const action = await vscode.window.showQuickPick(
        [
          { label: 'Accept', action: 'accept' },
          { label: 'Reject', action: 'reject' },
          { label: 'Explain', action: 'explain' },
          { label: 'Open Target', action: 'open' },
        ],
        { placeHolder: `${pick.label}` },
      );
      if (!action) return;
      if (action.action === 'accept') {
        if (await applySuggestionVerdict(pick.suggestion, 'accepted')) void reviewSuggestions();
      } else if (action.action === 'reject') {
        if (await applySuggestionVerdict(pick.suggestion, 'rejected')) void reviewSuggestions();
      } else if (action.action === 'explain') {
        await explainSuggestion(pick.suggestion);
      } else {
        await openSuggestionTarget(pick.suggestion);
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`FeatureMap: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const treeProvider = new FeatureTreeProvider(getClient);
  const treeView = vscode.window.createTreeView('featuremap.features', { treeDataProvider: treeProvider });
  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('featuremap.initializeAndScan', initializeAndScan),
    vscode.commands.registerCommand('featuremap.showFeatures', () => {
      void vscode.commands.executeCommand('featuremap.features.focus');
      void treeProvider.load();
    }),
    vscode.commands.registerCommand('featuremap.openFeature', (featureId?: string) => openFeature(featureId)),
    vscode.commands.registerCommand('featuremap.searchFeatures', searchFeatures),
    vscode.commands.registerCommand('featuremap.toggleGrouping', toggleGrouping),
    vscode.commands.registerCommand('featuremap.showRelatedFeatures', (featureId?: string, symbol?: IdeSymbolRef) => {
      void showRelatedFeatures(symbol ?? undefined);
    }),
    vscode.commands.registerCommand('featuremap.explainRelation', (featureId?: string, symbolId?: string) =>
      explainRelation(featureId, symbolId),
    ),
    vscode.commands.registerCommand('featuremap.showCurrentImpact', () => {
      void vscode.commands.executeCommand('featuremap.impact.focus');
      void impactTreeProvider.load();
    }),
    vscode.commands.registerCommand('featuremap.refreshCurrentImpact', () => {
      void refreshImpact([], 'manual');
    }),
    vscode.commands.registerCommand('featuremap.openImpactFile', (path?: string) => openImpactFile(path)),
    vscode.commands.registerCommand('featuremap.reviewSuggestions', reviewSuggestions),
    vscode.commands.registerCommand('featuremap.openSuggestionTarget', (suggestion?: IdeSuggestedRelation) => {
      if (suggestion) void openSuggestionTarget(suggestion);
    }),
    vscode.commands.registerCommand('featuremap.explainSuggestion', (suggestion?: IdeSuggestedRelation) => {
      if (suggestion) void explainSuggestion(suggestion);
    }),
    vscode.commands.registerCommand('featuremap.acceptSuggestion', (suggestion?: IdeSuggestedRelation) => {
      if (suggestion) void applySuggestionVerdict(suggestion, 'accepted');
    }),
    vscode.commands.registerCommand('featuremap.rejectSuggestion', (suggestion?: IdeSuggestedRelation) => {
      if (suggestion) void applySuggestionVerdict(suggestion, 'rejected');
    }),
    vscode.commands.registerCommand('featuremap.refresh', () => {
      void (async () => {
        await treeProvider.load();
        await refreshStatus();
      })();
    }),
    // Code intelligence providers (v0.6.2): Hover + CodeLens.
    registerHoverProvider(getClient),
    registerCodeLensProvider(getClient),
    // The service is owned by the extension (ADR-0008 §3): kill on deactivate.
    { dispose: () => client?.dispose() },
  );

  void (async () => {
    await refreshStatus();
    await treeProvider.load();
    await refreshDrift();
  })();

  // AI Context UX (v0.6.5) — the only consumer of the read-only
  // context.build projection (plan §1.2).
  registerContextUx(context, { getClient, repoRoot });
}

export function deactivate(): void {
  // Disposal of the spawned service happens through the subscriptions above.
}
