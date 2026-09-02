/**
 * Markdown Renderer — human-readable context for terminals and the Web.
 * Every line stays explainable (evidence attached to the important ones).
 */
import type { FeatureContext } from '../types.js';
import { entryLine, evidenceTrail, TIER_MARK } from './common.js';

export function renderMarkdown(context: FeatureContext): string {
  const out: string[] = [];
  const { feature } = context;

  out.push(`# Feature Context: ${feature.name}`);
  out.push('');
  out.push(
    `\`${feature.id}\` · ${feature.pattern} · status: ${feature.status} · confidence: ${feature.confidence}`,
  );
  if (feature.health && Object.keys(feature.health).length > 0) {
    out.push(
      `health: ${Object.entries(feature.health)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
  }
  if (context.task) out.push(`task: "${context.task.text}" (terms: ${context.task.terms.join(', ')})`);
  out.push('');

  if (context.purpose) {
    out.push('## Purpose');
    out.push('');
    out.push(context.purpose);
    out.push('');
  }
  if (context.summary) {
    out.push('> ' + context.summary);
    out.push('');
  }

  section(out, 'Entry Points', context.entryPoints);
  section(out, 'Core Implementation', context.coreCode);
  section(out, 'Dependencies', context.dependencies);
  section(out, 'Dependents (who depends on this feature)', context.dependents);
  section(out, 'Tests', context.tests);

  if (context.policies.length > 0) {
    out.push('## Policies / Constraints');
    out.push('');
    for (const p of context.policies) {
      const reqMark = p.level === 'required' ? ' (REQUIRED)' : p.level === 'recommended' ? ' (recommended)' : '';
      out.push(`- [${p.level}] ${p.text}${reqMark}`);
      out.push(`  source: ${p.source}${p.scope ? ` · scope: ${p.scope}` : ''}`);
    }
    out.push('');
  }

  if (context.recentChanges.length > 0) {
    out.push('## Recent Changes');
    out.push('');
    for (const c of context.recentChanges.slice(0, 10)) {
      const taskMark = c.taskMatched ? ' (task)' : '';
      out.push(
        `- \`${c.sha.slice(0, 7)}\` ${c.kind} ${c.author} ${c.committedAt ?? ''} — ${c.message ?? ''}${taskMark}`,
      );
      out.push(`  files: ${c.changedPaths.join(', ')}`);
    }
    out.push('');
  }

  if (context.changeRisks.length > 0) {
    out.push('## Change Risks');
    out.push('');
    for (const r of context.changeRisks) {
      out.push(`- [${r.band}] ${r.reason}`);
      out.push(`  ${evidenceTrail(r.evidence)}`);
    }
    out.push('');
  }

  if (context.evidence.length > 0) {
    out.push('## Evidence (consolidated)');
    out.push('');
    for (const e of context.evidence.slice(0, 12)) {
      out.push(
        `- ${e.sourceId ?? '?'} --${e.relationType ?? '?'}-> ${e.targetId ?? '?'} (${e.confidence.toFixed(2)}, ${e.analyzerId}, ${e.origin})`,
      );
    }
    out.push('');
  }

  if (context.truncationNote) {
    out.push(`> ⚠ ${context.truncationNote}`);
    out.push('');
  }
  out.push(
    `_budget: ${context.budget.requested} tokens (estimated ${context.budget.estimatedTotal}) · builder ${context.generatedBy.version} · output ${context.generatedBy.format}_`,
  );
  return out.join('\n');
}

function section(out: string[], title: string, items: FeatureContext['coreCode']): void {
  if (items.length === 0) return;
  out.push(`## ${title}`);
  out.push('');
  for (const e of items) {
    out.push(`- ${TIER_MARK[e.tier] ?? ''} ${entryLine(e)}`);
    const trail = evidenceTrail(e.evidence);
    if (trail) out.push(`  evidence: ${trail}`);
  }
  out.push('');
}