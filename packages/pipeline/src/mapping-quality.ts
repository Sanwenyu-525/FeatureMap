/**
 * Mapping-quality measurement — docs/releases/v0.2-acceptance.md §2.
 *
 * Compares a scan's feature↔code mappings against a fixture's
 * ground-truth YAML and reports Precision/Recall with the exact
 * misclassified candidates. Measurement only: no inference happens
 * here, and candidates that are neither expected nor notExpected count
 * as false positives (precision-first) and are listed as a
 * ground-truth gap for the fixture author.
 *
 * Two granularities:
 * - file   — measurable against the current endpoint-anchored
 *            discovery engine (BELONGS_TO_FEATURE file/test rows);
 * - symbol — the Milestone 7 acceptance target; reported as pending
 *            until the anchor-driven candidate engine emits
 *            symbol-level mappings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ScanJsonOutput } from './scan-runner.js';
import { slugify } from './feature-discovery.js';

export interface GroundTruthAnchor {
  type: string;
  target: string;
}

export interface GroundTruth {
  feature: string;
  pattern?: string;
  anchors: GroundTruthAnchor[];
  expected: string[];
  notExpected: string[];
  expectedFiles: string[];
  notExpectedFiles: string[];
}

export interface MappingMetrics {
  /** Resolved feature id, or undefined when the scan found no feature. */
  featureId: string | undefined;
  granularity: 'file' | 'symbol';
  candidates: string[];
  truePositives: string[];
  falsePositives: string[];
  /** Candidates neither expected nor notExpected — ground-truth gap. */
  unclassified: string[];
  falseNegatives: string[];
  precision: number;
  recall: number;
  /** True when the engine does not yet emit this granularity. */
  pending: boolean;
}

export function loadGroundTruth(
  fixtureRoot: string,
  fileName = 'ground-truth.yaml',
): GroundTruth {
  const parsed = parseYaml(readFileSync(join(fixtureRoot, fileName), 'utf8')) as
    | Partial<GroundTruth>
    | null;
  if (!parsed || typeof parsed.feature !== 'string' || parsed.feature === '') {
    throw new Error(`${join(fixtureRoot, fileName)}: "feature" is required`);
  }
  return {
    feature: parsed.feature,
    pattern: typeof parsed.pattern === 'string' ? parsed.pattern : undefined,
    anchors: Array.isArray(parsed.anchors) ? parsed.anchors : [],
    expected: parsed.expected ?? [],
    notExpected: parsed.notExpected ?? [],
    expectedFiles: parsed.expectedFiles ?? [],
    notExpectedFiles: parsed.notExpectedFiles ?? [],
  };
}

interface BelongsToRow {
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
}

/**
 * Candidate ids mapped to the feature, derived from the scan's
 * BELONGS_TO_FEATURE evidence. Endpoint anchors are resolved to their
 * registration file so anchors and closure share one id space.
 */
function candidatesFor(scan: ScanJsonOutput, featureId: string): string[] {
  const rows: BelongsToRow[] = scan.evidence.filter(
    (e) => e.relationType === 'BELONGS_TO_FEATURE' && e.targetId === featureId,
  );
  const endpointPath = new Map(scan.endpoints.map((e) => [e.name, e.path]));
  const candidates = new Set<string>();
  for (const row of rows) {
    if (row.sourceType === 'file' || row.sourceType === 'test') {
      candidates.add(row.sourceId);
    } else if (row.sourceType === 'endpoint') {
      const path = endpointPath.get(row.sourceId.slice('endpoint:'.length));
      if (path) candidates.add(path);
    }
  }
  return [...candidates].sort();
}

function score(
  featureId: string | undefined,
  granularity: MappingMetrics['granularity'],
  candidates: string[],
  expected: string[],
  notExpected: string[],
  pending: boolean,
): MappingMetrics {
  const expectedSet = new Set(expected);
  const notExpectedSet = new Set(notExpected);
  const candidateSet = new Set(candidates);

  const truePositives = candidates.filter((c) => expectedSet.has(c));
  const falsePositives = candidates.filter((c) => !expectedSet.has(c));
  const unclassified = falsePositives.filter((c) => !notExpectedSet.has(c));
  const falseNegatives = expected.filter((e) => !candidateSet.has(e));

  const precision = candidates.length === 0 ? 1 : truePositives.length / candidates.length;
  const recall = expected.length === 0 ? 1 : truePositives.length / expected.length;

  return {
    featureId,
    granularity,
    candidates,
    truePositives,
    falsePositives,
    unclassified,
    falseNegatives,
    precision,
    recall,
    pending,
  };
}

/** File-level P/R against the current discovery engine. */
export function measureFileMapping(scan: ScanJsonOutput, truth: GroundTruth): MappingMetrics {
  const featureId = `feature:${slugify(truth.feature)}`;
  const exists = scan.features.some((f) => f.id === featureId);
  const candidates = exists ? candidatesFor(scan, featureId) : [];
  return score(featureId, 'file', candidates, truth.expectedFiles, truth.notExpectedFiles, false);
}

/**
 * Symbol-level P/R — the Milestone 7 acceptance target.
 *
 * Candidates come from the anchor-driven expansion (scan.candidates,
 * status != rejected). Ground truth lists bare symbol names
 * (`AuthService.login`), so candidates are normalized into the same
 * name space: class methods are qualified through CONTAINS
 * class→method evidence, everything else uses its bare name.
 */
export function measureSymbolMapping(scan: ScanJsonOutput, truth: GroundTruth): MappingMetrics {
  const featureId = `feature:${slugify(truth.feature)}`;
  const rows = (scan.candidates ?? []).filter(
    (c) => c.featureId === featureId && c.targetType === 'symbol' && c.status !== 'rejected',
  );
  if (rows.length === 0) {
    return score(featureId, 'symbol', [], truth.expected, truth.notExpected, true);
  }
  const qualified = qualifiedMethodNames(scan);
  const candidates = [
    ...new Set(rows.map((r) => qualified.get(r.targetId) ?? bareSymbolName(r.targetId))),
  ].sort();
  return score(featureId, 'symbol', candidates, truth.expected, truth.notExpected, false);
}

/** `symbol:<path>:<name>` (or stored `<path>:<name>`) → `<name>`. */
function bareSymbolName(symbolId: string): string {
  const rest = symbolId.startsWith('symbol:') ? symbolId.slice('symbol:'.length) : symbolId;
  const idx = rest.lastIndexOf(':');
  return idx === -1 ? rest : rest.slice(idx + 1);
}

/** CONTAINS class→method evidence → map of stored id → `Class.method`. */
function qualifiedMethodNames(scan: ScanJsonOutput): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of scan.evidence) {
    if (ev.relationType !== 'CONTAINS' || ev.sourceType !== 'symbol') continue;
    const member = (ev.metadata as { member?: boolean } | null)?.member;
    if (!member) continue;
    map.set(
      ev.targetId.slice('symbol:'.length),
      `${bareSymbolName(ev.sourceId)}.${bareSymbolName(ev.targetId)}`,
    );
  }
  return map;
}

/** One-line gate summary for logs and reports. */
export function formatMetrics(metrics: MappingMetrics): string {
  const state = metrics.pending ? 'pending' : 'measured';
  return [
    `${metrics.featureId ?? '(feature not found)'} [${metrics.granularity}/${state}]`,
    `precision=${(metrics.precision * 100).toFixed(1)}%`,
    `recall=${(metrics.recall * 100).toFixed(1)}%`,
    `candidates=${metrics.candidates.length}`,
    `fp=${metrics.falsePositives.length}`,
    `fn=${metrics.falseNegatives.length}`,
  ].join(' ');
}
