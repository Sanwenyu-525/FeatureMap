/**
 * Current Change Impact tree (v0.6.3 plan §11–§18).
 *
 * Severity groups (HIGH → MEDIUM → LOW) → affected Features → Why /
 * Tests / Documents. It only renders the cached snapshot — reasons are
 * consumed verbatim from analyzeImpact, never re-derived in the
 * extension (plan §14/§39).
 */
import * as vscode from 'vscode';
import type { FeatureMapClient, IdeCurrentAffectedFeature, IdeCurrentImpactSnapshot } from '../client/featuremap-client';

const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const SEVERITY_ICONS: Record<string, string> = { HIGH: 'error', MEDIUM: 'warning', LOW: 'info' };

export type ImpactNodeKind = 'severity' | 'feature' | 'section' | 'leaf' | 'message';

export class ImpactNode extends vscode.TreeItem {
  constructor(
    public readonly kind: ImpactNodeKind,
    public override readonly label: string,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly payload?: {
      feature?: IdeCurrentAffectedFeature;
      text?: string;
      path?: string;
      severity?: string;
    },
  ) {
    super(label, collapsibleState);
    if (kind === 'message') {
      this.contextValue = 'message';
    } else if (kind === 'severity' && payload?.severity) {
      this.contextValue = 'severity';
      this.iconPath = new vscode.ThemeIcon(SEVERITY_ICONS[payload.severity] ?? 'circle-outline');
    } else if (kind === 'feature' && payload?.feature) {
      this.contextValue = 'feature';
      this.description = payload.feature.severity;
      this.iconPath = new vscode.ThemeIcon('symbol-method');
      this.command = { command: 'featuremap.openFeature', title: 'Open Feature', arguments: [payload.feature.featureId] };
    } else if (kind === 'section') {
      this.contextValue = 'section';
    } else if (kind === 'leaf' && payload?.path) {
      this.contextValue = 'leaf-file';
      this.command = { command: 'featuremap.openImpactFile', title: 'Open', arguments: [payload.path] };
    } else if (kind === 'leaf') {
      this.contextValue = 'leaf';
    }
  }
}

export class ImpactTreeProvider implements vscode.TreeDataProvider<ImpactNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ImpactNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private snapshot?: IdeCurrentImpactSnapshot;

  constructor(private readonly getClient: () => FeatureMapClient | undefined) {}

  /** Load the cached snapshot (cheap: impact.current never re-analyzes). */
  async load(): Promise<void> {
    const client = this.getClient();
    this.snapshot = undefined;
    if (client) {
      try {
        const current = await client.request<{ available: boolean; snapshot?: IdeCurrentImpactSnapshot }>('impact.current');
        this.snapshot = current.snapshot;
      } catch {
        this.snapshot = undefined;
      }
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ImpactNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ImpactNode): vscode.ProviderResult<ImpactNode[]> {
    if (!this.snapshot) {
      return [new ImpactNode('message', 'Current impact has not been analyzed yet.', vscode.TreeItemCollapsibleState.None)];
    }
    if (element) {
      return this.childrenOf(element);
    }
    if (this.snapshot.affectedFeatures.length === 0) {
      return [new ImpactNode('message', 'No affected features in the current working tree.', vscode.TreeItemCollapsibleState.None)];
    }
    return SEVERITIES.filter((s) => this.snapshot!.summary.bySeverity[s] > 0).map(
      (severity) =>
        new ImpactNode('severity', `${severity} · ${this.snapshot!.summary.bySeverity[severity]}`, vscode.TreeItemCollapsibleState.Expanded, {
          severity,
        }),
    );
  }

  private childrenOf(element: ImpactNode): ImpactNode[] {
    if (element.kind === 'severity' && element.payload?.severity && this.snapshot) {
      const features = this.snapshot.affectedFeatures
        .filter((f) => f.severity === element.payload!.severity)
        .sort((a, b) => a.name.localeCompare(b.name));
      return features.map(
        (f) => new ImpactNode('feature', f.name, vscode.TreeItemCollapsibleState.Collapsed, { feature: f }),
      );
    }
    if (element.kind === 'feature' && element.payload?.feature) {
      const f = element.payload.feature;
      const sections: ImpactNode[] = [];
      if (f.reasons.length > 0) {
        sections.push(new ImpactNode('section', 'Why', vscode.TreeItemCollapsibleState.Expanded, { feature: f, text: 'reasons' }));
      }
      if (f.tests.length > 0) {
        sections.push(new ImpactNode('section', `Tests · ${f.tests.length}`, vscode.TreeItemCollapsibleState.Expanded, { feature: f, text: 'tests' }));
      }
      if (f.documents.length > 0) {
        sections.push(new ImpactNode('section', `Documents · ${f.documents.length}`, vscode.TreeItemCollapsibleState.Expanded, { feature: f, text: 'documents' }));
      }
      return sections;
    }
    if (element.kind === 'section' && element.payload?.feature) {
      return this.leafNodes(element);
    }
    return [];
  }

  private leafNodes(section: ImpactNode): ImpactNode[] {
    const feature = section.payload?.feature;
    if (!feature) return [];
    const group = section.payload?.text;
    if (group === 'reasons') {
      return feature.reasons.map(
        (r) => new ImpactNode('leaf', r, vscode.TreeItemCollapsibleState.None, { text: r }),
      );
    }
    if (group === 'tests') {
      return feature.tests.map(
        (p) => new ImpactNode('leaf', p, vscode.TreeItemCollapsibleState.None, { path: p }),
      );
    }
    if (group === 'documents') {
      return feature.documents.map(
        (p) => new ImpactNode('leaf', p, vscode.TreeItemCollapsibleState.None, { path: p }),
      );
    }
    return [];
  }
}
