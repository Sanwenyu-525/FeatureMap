/**
 * Check renderer (Phase 4 / ADR-0006 §3) — pure, deterministic.
 *
 * Turns a `PrReport` into a GitHub Checks API payload:
 *
 *   conclusion — `success` by default; `neutral` ("review recommended")
 *                when risk is HIGH or a mapping relation was broken.
 *                Analysis failure is reported as a `failure` run by the
 *                runner, never silently dropped (ADR-0006 §4, §14 gate:
 *                informational in phase one — no merge gating).
 *   title      — fixed name for a stable, persistent check.
 *   summary    — one-line digest shown in the checks list.
 *   text       — full markdown body (Feature Impact / Risk / Tests /
 *                Mapping / Warnings).
 *
 * The body is generated from normalized report data only; no source
 * content is included (AGENTS.md §13).
 */
import type { PrReport } from '@featuremap/pipeline';

/** Stable check-run name so re-runs update the same run (ADR-0006 §3). */
export const DEFAULT_CHECK_NAME = 'FeatureMap / Pull Request Analysis';

export interface RenderedCheck {
  conclusion: 'success' | 'neutral';
  title: string;
  summary: string;
  text: string;
}

/** Severity ordering used for the impact table. */
const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

/** One line of the impact table: keep the first reason, note the count. */
function firstReason(feature: PrReport['affectedFeatures'][number]): string {
  const first = feature.reasons[0] ?? '';
  return feature.reasons.length > 1 ? `${first} (+${feature.reasons.length - 1} more)` : first;
}

function impactTable(report: PrReport): string {
  if (report.affectedFeatures.length === 0) return '_No affected features._';
  const rows = [...report.affectedFeatures]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .map((f) => `| ${f.severity} | ${f.featureName} | ${firstReason(f)} |`)
    .join('\n');
  return ['| Severity | Feature | Reason |', '|---|---|---|', rows].join('\n');
}

function sharedInfrastructureSection(report: PrReport): string {
  if (report.sharedInfrastructure.length === 0) return '';
  const rows = report.sharedInfrastructure
    .map((s) => `- \`${s.path}\` — ${s.reason}`)
    .join('\n');
  return `\n## Shared Infrastructure\n${rows}`;
}

function riskSection(report: PrReport): string {
  if (report.risk.contributions.length === 0) return `\n## Risk\n**${report.risk.band}** — no significant risk signals.`;
  const rows = report.risk.contributions.map((c) => `- +${c.points} ${c.reason}`).join('\n');
  return `\n## Risk\n**${report.risk.band}**\n${rows}`;
}

function testsSection(report: PrReport): string {
  if (report.testCoverage.length === 0) return '';
  const rows = report.testCoverage
    .map((t) => `- ${t.changed ? '✓' : '⚠'} \`${t.path}\``)
    .join('\n');
  return `\n## Tests\n(⚠ = potential missing coverage — a test change is not always required)\n${rows}`;
}

function mappingSection(report: PrReport): string {
  if (report.mappingDrift.length === 0) return '\n## Mapping\n✓ No stale mapping detected.';
  const rows = report.mappingDrift
    .map((d) => `- **[${d.kind}]** ${d.featureName ?? d.featureId}: ${d.reason}`)
    .join('\n');
  return `\n## Mapping\n${rows}`;
}

function warningsSection(report: PrReport): string {
  const lines: string[] = [];
  for (const u of report.suppressedUncertainty) {
    lines.push(`- ${u.featureName ?? u.featureId} — confidence ${u.confidence} (${u.reason})`);
  }
  for (const d of report.staleDocuments) {
    lines.push(`- \`${d.path}\` — ${d.reason}`);
  }
  if (lines.length === 0) return '';
  return `\n## Warnings\n${lines.join('\n')}`;
}

export function renderPrCheck(report: PrReport): RenderedCheck {
  const high = report.risk.band === 'HIGH';
  const broken = report.mappingDrift.some((d) => d.kind === 'relation_broken');
  const conclusion = high || broken ? 'neutral' : 'success';

  const changed = report.testCoverage.filter((t) => t.changed).length;
  const unchanged = report.testCoverage.filter((t) => !t.changed).length;
  const driftCount = report.mappingDrift.length;

  const summary =
    `Affected features: ${report.affectedFeatures.length} · Risk: ${report.risk.band}` +
    (report.testCoverage.length > 0 ? ` · Tests: ✓${changed} ⚠${unchanged}` : '') +
    (driftCount > 0 ? ` · Drift: ${driftCount}` : '');

  const sections = [
    `## Feature Impact\n${impactTable(report)}`,
    sharedInfrastructureSection(report),
    riskSection(report),
    testsSection(report),
    mappingSection(report),
    warningsSection(report),
  ].filter(Boolean);

  return {
    conclusion,
    title: DEFAULT_CHECK_NAME,
    summary,
    text: sections.join('\n'),
  };
}
