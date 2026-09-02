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
  type IdeFeatureDetail,
  type IdeProjectStatus,
} from './client/featuremap-client';
import { FeatureTreeProvider } from './providers/feature-tree-provider';

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
        await vscode.window.showTextDocument(doc);
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
    vscode.commands.registerCommand('featuremap.refresh', () => {
      void (async () => {
        await treeProvider.load();
        await refreshStatus();
      })();
    }),
    // The service is owned by the extension (ADR-0008 §3): kill on deactivate.
    { dispose: () => client?.dispose() },
  );

  void (async () => {
    await refreshStatus();
    await treeProvider.load();
  })();
}

export function deactivate(): void {
  // Disposal of the spawned service happens through the subscriptions above.
}
