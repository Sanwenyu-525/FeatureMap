/**
 * Feature Explorer tree provider (Phase 6 / v0.6.1).
 *
 * Code-oriented Explorer with status grouping and a flat mode. Text
 * search is available via the view's built-in find widget and the
 * `featuremap.searchFeatures` QuickPick command. Clicking a feature
 * opens its core code (Feature → Symbol → source).
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeFeature } from '../client/featuremap-client';
import { groupFeatures, type FeatureGroup, type GroupMode } from './tree-grouping';

export class FeatureNode extends vscode.TreeItem {
  constructor(
    public readonly kind: 'group' | 'feature' | 'message',
    public override readonly label: string,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
    options: { feature?: IdeFeature; group?: FeatureGroup } = {},
  ) {
    super(label, collapsibleState);
    const { feature, group } = options;
    this.feature = feature;
    this.group = group;
    if (kind === 'message') {
      this.contextValue = 'message';
      this.tooltip = label;
    } else if (kind === 'group' && group) {
      this.contextValue = 'group';
      this.description = `${group.features.length}`;
      this.iconPath = new vscode.ThemeIcon(group.icon);
    } else if (kind === 'feature' && feature) {
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

  public readonly feature?: IdeFeature;
  public readonly group?: FeatureGroup;
}

export class FeatureTreeProvider implements vscode.TreeDataProvider<FeatureNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FeatureNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private features: IdeFeature[] = [];
  private mode: GroupMode = 'status';

  constructor(private readonly getClient: () => FeatureMapClient | undefined) {}

  /** Reload features (optionally filtered) from the service and refresh. */
  async load(query?: string): Promise<void> {
    const client = this.getClient();
    this.features = [];
    if (client) {
      try {
        this.features = await client.request<IdeFeature[]>('features.list', query ? { query } : undefined);
      } catch {
        this.features = [];
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getMode(): GroupMode {
    return this.mode;
  }

  setMode(mode: GroupMode): void {
    this.mode = mode;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FeatureNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FeatureNode): vscode.ProviderResult<FeatureNode[]> {
    if (this.features.length === 0) {
      return [
        new FeatureNode('message', 'No features yet — run Initialize & Scan.', vscode.TreeItemCollapsibleState.None),
      ];
    }
    if (!element) {
      const groups = groupFeatures(this.features, this.mode);
      if (this.mode === 'flat') {
        return groups[0]?.features.map(
          (feature) => new FeatureNode('feature', feature.name, vscode.TreeItemCollapsibleState.None, { feature }),
        ) ?? [];
      }
      return groups.map(
        (group) =>
          new FeatureNode('group', group.label, vscode.TreeItemCollapsibleState.Expanded, { group }),
      );
    }
    if (element.kind === 'group' && element.group) {
      return element.group.features.map(
        (feature) => new FeatureNode('feature', feature.name, vscode.TreeItemCollapsibleState.None, { feature }),
      );
    }
    return [];
  }
}
