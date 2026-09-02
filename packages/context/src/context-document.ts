/**
 * FeatureContext Document (v0.6.5 plan §1–§17).
 *
 * The canonical presentation projection shared by CLI, IDE and MCP:
 *
 *   buildFeatureContext()   ← the only context builder (read-only)
 *   buildFeatureContextDocument() → Recommended Files + canonical
 *       Markdown + deterministic contextId + artifact path
 *
 * Only this API ever produces Agent-facing Markdown, so CLI / IDE Copy /
 * Preview / Save can never diverge (plan §1.3). Context stays a read-only
 * projection: nothing here writes the graph, and no source bodies leak.
 */
import { createHash } from 'node:crypto';
import type { CodeEntry, FeatureContext, FeatureContextBudget, PolicyEntry, RecentChangeEntry, RiskSignal } from './types.js';
import { buildFeatureContext } from './context-builder.js';

export const MAX_RECOMMENDED_FILES = 12;

export type ContextDocumentRole = 'core' | 'dependency' | 'test' | 'policy' | 'change' | 'other';

export interface ContextDocumentEntry {
  path: string;
  role: ContextDocumentRole;
  symbol?: { id?: string; name: string; signature?: string; startLine?: number; endLine?: number };
  relation?: { type: string; featureId?: string; targetId?: string };
  evidence?: Array<{ relationType?: string; confidence?: number; analyzerId?: string }>;
  summary?: string;
}

export interface ContextDocumentSections {
  purpose?: string;
  core: ContextDocumentEntry[];
  dependencies: ContextDocumentEntry[];
  tests: ContextDocumentEntry[];
  policies: ContextDocumentEntry[];
  changes: ContextDocumentEntry[];
  other: ContextDocumentEntry[];
}

export interface RecommendedFile {
  path: string;
  roles: ContextDocumentRole[];
  reason: string;
  location?: { startLine: number; endLine?: number };
  symbols?: Array<{ name: string; signature?: string; startLine?: number }>;
}

export interface FeatureContextDocument {
  formatVersion: 1;
  contextId: string;
  feature: { id: string; name: string };
  task?: string;
  sections: ContextDocumentSections;
  recommendedFiles: RecommendedFile[];
  budget?: Pick<FeatureContextBudget, 'requested' | 'estimatedTotal' | 'allocation'>;
  markdown: string;
  artifact: { relativePath: string };
}

/** Trim; empty/whitespace → undefined so CLI and IDE normalize identically (plan §24). */
export function normalizeTask(task?: string): string | undefined {
  const normalized = task?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

/** Feature id → filesystem-safe token. */
export function safeFeatureId(featureId: string): string {
  const bare = featureId.replace(/^feature:/, '');
  const safe = bare.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'feature';
}

/** Deterministic context id: safe feature id + optional 8-char task hash (plan §12). */
export function contextIdOf(featureId: string, task?: string): string {
  const base = safeFeatureId(featureId);
  const normalized = normalizeTask(task);
  if (!normalized) return base;
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

/** `path:start-end` span → 1-based lines (plan §26 keeps 1-based at the service). */
function linesOf(span?: string): { startLine?: number; endLine?: number } {
  if (!span) return {};
  const range = span.split(':')[1];
  if (!range) return {};
  const [start, end] = range.split('-').map((n) => Number.parseInt(n, 10));
  return { startLine: Number.isNaN(start) ? undefined : start, endLine: Number.isNaN(end) ? undefined : end };
}

function toEntry(entry: CodeEntry, role: ContextDocumentRole): ContextDocumentEntry | undefined {
  const path = entry.file;
  if (!path) return undefined;
  const lines = linesOf(entry.span);
  return {
    path,
    role,
    ...(entry.name
      ? {
          symbol: {
            id: entry.id,
            name: entry.name,
            signature: entry.symbolType,
            startLine: lines.startLine,
            endLine: lines.endLine,
          },
        }
      : lines.startLine !== undefined
        ? { symbol: { name: entry.name ?? path, startLine: lines.startLine, endLine: lines.endLine } }
        : {}),
    evidence: entry.evidence.slice(0, 5).map((e) => ({
      relationType: e.relationType,
      confidence: e.confidence,
      analyzerId: e.analyzerId,
    })),
  };
}

function toPolicyEntry(p: PolicyEntry): ContextDocumentEntry {
  return {
    path: p.source,
    role: 'policy',
    summary: p.text,
  };
}

function toChangeEntry(c: RecentChangeEntry): ContextDocumentEntry {
  return {
    path: c.changedPaths[0] ?? '',
    role: 'change',
    summary: `${c.kind} ${c.message ?? ''}`.trim(),
  };
}

function toRiskEntry(r: RiskSignal): ContextDocumentEntry {
  return {
    path: '',
    role: 'change',
    summary: `[${r.band}] ${r.reason}`,
  };
}

/** Map the budgeted FeatureContext onto stable document sections (plan §5). */
export function mapDocumentSections(context: FeatureContext): ContextDocumentSections {
  const core = [...context.entryPoints, ...context.coreCode]
    .map((e) => toEntry(e, 'core'))
    .filter((e): e is ContextDocumentEntry => !!e);
  const dependencies = context.dependencies
    .map((e) => toEntry(e, 'dependency'))
    .filter((e): e is ContextDocumentEntry => !!e);
  const tests = context.tests.map((e) => toEntry(e, 'test')).filter((e): e is ContextDocumentEntry => !!e);
  const policies = context.policies.map(toPolicyEntry);
  const changes = [
    ...context.recentChanges.map(toChangeEntry),
    ...context.changeRisks.map(toRiskEntry),
  ];
  const other = context.dependents
    .map((e) => toEntry(e, 'other'))
    .filter((e): e is ContextDocumentEntry => !!e);
  return { purpose: context.purpose, core, dependencies, tests, policies, changes, other };
}

const ROLE_REASON: Record<ContextDocumentRole, (featureName: string) => string> = {
  core: (f) => `Core implementation for ${f}`,
  dependency: () => 'Direct dependency referenced by core code',
  test: () => 'Relevant test coverage',
  policy: () => 'Related policy',
  change: () => 'Changed file relevant to the current working tree',
  other: () => 'Related code',
};

/**
 * Recommended Files are a projection of the **final budgeted/ranked
 * context only** — never a re-query of the graph (plan §7–§11). Order
 * follows the first appearance in the ranked sections; roles merge per
 * path; no second relevance score.
 */
export function deriveRecommendedFiles(
  sections: ContextDocumentSections,
  featureName: string,
): RecommendedFile[] {
  const order: Array<[ContextDocumentRole, ContextDocumentEntry[]]> = [
    ['core', sections.core],
    ['dependency', sections.dependencies],
    ['test', sections.tests],
    ['policy', sections.policies],
    ['change', sections.changes],
    ['other', sections.other],
  ];
  const byPath = new Map<string, RecommendedFile>();
  const result: RecommendedFile[] = [];
  const push = (role: ContextDocumentRole, entry: ContextDocumentEntry): void => {
    if (!entry.path) return;
    const existing = byPath.get(entry.path);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      if (entry.symbol?.name) {
        existing.symbols ??= [];
        if (!existing.symbols.some((s) => s.name === entry.symbol!.name)) {
          existing.symbols.push({
            name: entry.symbol.name,
            signature: entry.symbol.signature,
            startLine: entry.symbol.startLine,
          });
        }
      }
      if (!existing.location?.startLine && entry.symbol?.startLine) {
        existing.location = { startLine: entry.symbol.startLine, endLine: entry.symbol.endLine };
      }
      return;
    }
    const file: RecommendedFile = {
      path: entry.path,
      roles: [role],
      reason: ROLE_REASON[role](featureName),
      ...(entry.symbol?.startLine ? { location: { startLine: entry.symbol.startLine, endLine: entry.symbol.endLine } } : {}),
      ...(entry.symbol?.name ? { symbols: [{ name: entry.symbol.name, signature: entry.symbol.signature, startLine: entry.symbol.startLine }] } : {}),
    };
    byPath.set(entry.path, file);
    result.push(file);
  };
  for (const [role, entries] of order) {
    for (const entry of entries) push(role, entry);
  }
  return result.slice(0, MAX_RECOMMENDED_FILES);
}

/** Canonical Agent-facing Markdown — the single formatter for CLI/IDE/MCP (plan §14–§16). */
export function renderFeatureContextMarkdown(document: FeatureContextDocument): string {
  const out: string[] = [];
  out.push(`# Feature Context: ${document.feature.name}`);
  out.push('');
  out.push(`\`${document.feature.id}\``);
  if (document.task) {
    out.push('');
    out.push('## Task');
    out.push('');
    out.push(document.task);
  }
  if (document.sections.purpose) {
    out.push('');
    out.push('## Purpose');
    out.push('');
    out.push(document.sections.purpose);
  }
  out.push('');
  out.push('## Core Code');
  out.push('');
  for (const e of document.sections.core) {
    out.push(`- ${entryMarkdown(e)}`);
  }
  out.push('');
  out.push('## Dependencies');
  out.push('');
  for (const e of document.sections.dependencies) out.push(`- ${entryMarkdown(e)}`);
  out.push('');
  out.push('## Tests');
  out.push('');
  for (const e of document.sections.tests) out.push(`- ${entryMarkdown(e)}`);
  out.push('');
  out.push('## Policies');
  out.push('');
  for (const e of document.sections.policies) out.push(`- ${e.summary ?? e.path}`);
  out.push('');
  out.push('## Change Impact');
  out.push('');
  for (const e of document.sections.changes) {
    if (e.path) out.push(`- \`${e.path}\`${e.summary ? ` — ${e.summary}` : ''}`);
    else if (e.summary) out.push(`- ${e.summary}`);
  }
  out.push('');
  out.push('## Recommended Files');
  out.push('');
  if (document.recommendedFiles.length === 0) {
    out.push('- none');
  } else {
    for (let i = 0; i < document.recommendedFiles.length; i += 1) {
      const f = document.recommendedFiles[i]!;
      out.push(`${i + 1}. \`${f.path}\``);
      out.push(`   - ${f.reason}`);
      for (const s of f.symbols ?? []) {
        out.push(`   - \`${s.name}\`${s.signature ? `(${s.signature})` : ''}`);
      }
    }
  }
  return out.join('\n');
}

function entryMarkdown(e: ContextDocumentEntry): string {
  if (e.symbol?.name) {
    return `\`${e.path}\` — \`${e.symbol.name}\`${e.symbol.signature ? ` (${e.symbol.signature})` : ''}`;
  }
  return `\`${e.path}\``;
}

export interface BuildContextDocumentOptions {
  task?: string;
  dbPath?: string;
  /** CLI-facing tuning; the IDE context.build deliberately does not expose these (plan §21). */
  budget?: number;
  depth?: number;
  includeHistory?: boolean;
  includeTests?: boolean;
}

/**
 * Derive the canonical presentation document from an already-built
 * FeatureContext. Shared by every surface that has the full context in
 * hand (CLI / MCP / IDE / HTTP) so a second build is never needed.
 */
export function documentFromContext(context: FeatureContext, task?: string): FeatureContextDocument {
  const normalizedTask = normalizeTask(task);
  const contextId = contextIdOf(context.feature.id, normalizedTask);
  const sections = mapDocumentSections(context);
  const recommendedFiles = deriveRecommendedFiles(sections, context.feature.name);
  const document: FeatureContextDocument = {
    formatVersion: 1,
    contextId,
    feature: { id: context.feature.id, name: context.feature.name },
    task: normalizedTask,
    sections,
    recommendedFiles,
    budget: {
      requested: context.budget.requested,
      estimatedTotal: context.budget.estimatedTotal,
      allocation: context.budget.allocation,
    },
    artifact: { relativePath: `.featuremap/context/${contextId}.md` },
    markdown: '',
  };
  return { ...document, markdown: renderFeatureContextMarkdown(document) };
}

/** Build the canonical presentation document (wraps the read-only builder). */
export function buildFeatureContextDocument(
  repoRoot: string,
  featureId: string,
  options: BuildContextDocumentOptions = {},
): FeatureContextDocument {
  const task = normalizeTask(options.task);
  const context = buildFeatureContext(repoRoot, featureId, {
    task,
    dbPath: options.dbPath,
    budget: options.budget,
    depth: options.depth,
    includeHistory: options.includeHistory,
    includeTests: options.includeTests,
  });
  return documentFromContext(context, task);
}
