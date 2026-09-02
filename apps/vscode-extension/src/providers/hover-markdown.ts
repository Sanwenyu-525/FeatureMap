/**
 * Hover markdown source (v0.6.2 plan §7.4/§7.5) — pure, testable.
 *
 * Hover = orientation: owning feature, up to 3 direct dependencies, up
 * to 2 tests, and action links. Extra content stays in the Panel.
 */
import type { IdeCodeIntelligence } from '../client/featuremap-client';

export function commandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

export function renderHoverMarkdownSource(info: IdeCodeIntelligence): string {
  const out: string[] = ['**FeatureMap**', ''];
  const primary = info.primaryFeature;
  if (primary) {
    const pct = Math.round(primary.confidence * 100);
    out.push(`**${primary.name}** — ${primary.relation} · ${pct}%`, '');
  }
  if (info.relatedFeatures.length > 1) {
    const extra = info.relatedFeatures.length - 1;
    out.push(`_+${extra} related feature${extra > 1 ? 's' : ''}_`, '');
  }
  if (info.directDependencies.length > 0) {
    out.push('**Direct dependencies**');
    for (const d of info.directDependencies.slice(0, 3)) out.push(`- \`${d.name}\``);
    out.push('');
  }
  if (info.tests.length > 0) {
    out.push('**Tests**');
    for (const t of info.tests.slice(0, 2)) out.push(`- \`${t.path}\``);
    out.push('');
  }
  if (primary) {
    out.push(
      `[Explain relation](${commandUri('featuremap.explainRelation', [primary.id, info.symbol.id])}) · ` +
        `[Open feature](${commandUri('featuremap.openFeature', [primary.id])})`,
    );
  }
  return out.join('\n');
}
