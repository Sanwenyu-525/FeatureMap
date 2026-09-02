/**
 * Agent Renderer — high-density context for AI coding agents.
 *
 * Structure follows the Phase 5 spec; output is dense (one line per
 * item), keeps evidence, distinguishes facts from inference, and ends
 * with "Recommended Files To Inspect" — a curated list of paths the
 * agent should READ next. The context intentionally does NOT contain
 * source bodies: the agent reads files itself (deterministic facts
 * over AI guesses; precision over recall).
 */
import type { FeatureContext } from '../types.js';
import { entryLine, evidenceTrail, provenanceOf, TIER_MARK } from './common.js';

export function renderAgent(context: FeatureContext): string {
  const out: string[] = [];
  const { feature } = context;

  out.push(`# Feature Context: ${feature.name}`);
  out.push('');
  out.push(`feature id: ${feature.id} | pattern: ${feature.pattern} | status: ${feature.status}`);
  out.push('');

  if (context.purpose) {
    out.push('## Purpose');
    out.push(context.purpose);
    out.push('');
  }
  if (context.task) {
    out.push(`## Task`);
    out.push(`${context.task.text}`);
    out.push('');
  }

  dense(out, '## Core Implementation', context.coreCode);
  dense(out, '## Entry Points', context.entryPoints);
  dense(out, '## Dependencies', context.dependencies);
  dense(out, '## Dependents', context.dependents);
  dense(out, '## Tests', context.tests);

  if (context.constraints.length > 0) {
    out.push('## Constraints');
    for (const c of context.constraints) {
      out.push(`- ${c.text}`);
      out.push(`  source: ${c.source}${c.scope ? ` scope=${c.scope}` : ''}`);
    }
    out.push('');
  }
  if (context.policies.some((p) => p.level !== 'required')) {
    out.push('## Policies (non-required)');
    for (const p of context.policies.filter((x) => x.level !== 'required')) {
      out.push(`- [${p.level}] ${p.text} (${p.source})`);
    }
    out.push('');
  }

  if (context.changeRisks.length > 0) {
    out.push('## Change Risks');
    for (const r of context.changeRisks) {
      out.push(`- [${r.band}] ${r.reason}`);
    }
    out.push('');
  }

  if (context.recentChanges.length > 0) {
    out.push('## Relevant Recent Changes');
    for (const c of context.recentChanges.slice(0, 8)) {
      const mark = c.taskMatched ? ' [task-relevant]' : '';
      out.push(`- ${c.sha.slice(0, 7)} ${c.kind} ${c.author}: ${c.message ?? ''}${mark}`);
      out.push(`  touched: ${c.changedPaths.join(', ')}`);
    }
    out.push('');
  }

  out.push('## Recommended Files To Inspect');
  const files = inspectList(context);
  for (const f of files) out.push(`- ${f}`);
  out.push('');

  if (context.truncationNote) out.push(`WARN: ${context.truncationNote}`);

  out.push(
    `[budget ${context.budget.requested}, estimated ${context.budget.estimatedTotal}, evidence rows ${context.evidence.length}, builder ${context.generatedBy.version}]`,
  );
  return out.join('\n');
}

function dense(out: string[], title: string, items: FeatureContext['coreCode']): void {
  if (items.length === 0) return;
  out.push(title);
  for (const e of items) {
    let line = `${TIER_MARK[e.tier] ?? ''} ${entryLine(e)}`;
    const trail = evidenceTrail(e.evidence);
    if (trail) line += ` | ${trail}`;
    out.push(line);
  }
  out.push('');
}

/** Curated read-first list: entry points + tier-1/2 core files, deduplicated. */
function inspectList(context: FeatureContext): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const push = (file?: string): void => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    files.push(file);
  };
  for (const e of context.entryPoints) push(e.file ?? e.name);
  for (const e of context.coreCode) {
    if (e.tier <= 2) push(e.file);
  }
  for (const e of context.dependencies) {
    if (e.tier <= 2) push(e.file);
  }
  return files.slice(0, 12);
}

/** Provenance is surfaced inside entryLine; re-export for renderers. */
export { provenanceOf };