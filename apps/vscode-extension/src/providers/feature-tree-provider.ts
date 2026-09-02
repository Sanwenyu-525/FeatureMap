/**
 * Feature Explorer tree provider (Phase 6 / Milestone 19–20).
 *
 * v0.6.0: a flat, code-oriented feature list (grouping / status /
 * search arrive in v0.6.1). Clicking a feature opens its core code.
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeFeature } from '../client/featuremap-client';

export class FeatureNode extends vscode.TreeItem {
  constructor(
    public override readonly label: string,
    public readonly kind: 'feature' | 'message',
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly feature?: IdeFeature,
  ) {
    super(label, collapsibleState);
    if (kind === 'message') {
      this.contextValue = 'message';
      this.tooltip = label;
    } else if (feature) {
      this.contextValue = 'feature';
      this.description = feature.pattern;
      this.tooltip = feature.description ?? feature.name;
      this.iconPath = new vscode.ThemeIcon(feature.status === 'active' ? 'symbol-method' : 'circle-outline');
      this.command = {
        command: 'featuremap.openFeature',
        title: 'Open Feature',
        arguments: [feature.id],
      };
    }
  }
}

export class FeatureTreeProvider implements vscode.TreeDataProvider<FeatureNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FeatureNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private features: IdeFeature[] = [];

  constructor(private readonly getClient: () => FeatureMapClient | undefined) {}

  /** Reload features from the service and refresh the view. */
  async load(): Promise<void> {
    const client = this.getClient();
    this.features = [];
    if (client) {
      try {
        this.features = await client.request<IdeFeature[]>('features.list');
      } catch {
        this.features = [];
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FeatureNode): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: FeatureNode): vscode.ProviderResult<FeatureNode[]> {
    if (this.features.length === 0) {
      return [
        new FeatureNode('No features yet — run Initialize & Scan.', 'message', vscode.TreeItemCollapsibleState.None),
      ];
    }
    return this.features.map(
      (feature) => new FeatureNode(feature.name, 'feature', vscode.TreeItemCollapsibleState.None, feature),
    );
  }
}
