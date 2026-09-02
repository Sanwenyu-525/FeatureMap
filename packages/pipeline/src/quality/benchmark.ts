/**
 * Deterministic mapping benchmark runner (v0.7.1, Milestone 26 §Stage 2–3).
 *
 * fresh scan → resolve ground truth → compare predictions → metrics →
 * structured failures. It consumes the production confidence policy
 * (`CODE_INTELLIGENCE_POLICY.codeLensMinConfidence`) — never a second
 * threshold — and reports precision/recall, high-confidence false
 * positives, shared-infrastructure promotion and cross-feature wrong
 * ownership, plus a failure list that pins each metric to evidence.
 */
import { CODE_INTELLIGENCE_POLICY } from '../code-intelligence/policy.js';
import { runScan, type CandidateDto, type ScanJsonOutput } from '../scan-runner.js';
import { loadMappingBenchmark } from './load.js';
import { normalizeFeatureId, resolveTarget } from './resolve.js';
import type { BenchmarkRelation, BenchmarkTarget, MappingBenchmarkSpec } from './types.js';

/** High-confidence = the same threshold CodeLens uses (shared policy). */
export const HIGH_CONFIDENCE_THRESHOLD = CODE_INTELLIGENCE_POLICY.codeLensMinConfidence;

export interface BenchmarkPrediction {
  candidateId: string;
  targetType: CandidateDto['targetType'];
  relation: BenchmarkRelation;
  status: CandidateDto['status'];
  score: number;
  distance: number;
  fanIn: number;
}

export type MappingFailureType =
  | 'false_negative'
  | 'false_positive'
  | 'high_confidence_false_positive'
  | 'shared_infra_promotion'
  | 'wrong_ownership';

export interface MappingFailure {
  fixture: string;
  type: MappingFailureType;
  featureId: string;
  target: BenchmarkTarget;
  expected?: string;
  actual?: string;
  score?: number;
  distance?: number;
  fanIn?: number;
  tags: string[];
}

export interface MetricSet {
  precision: number;
  recall: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export interface MappingBenchmarkResult {
  fixture: string;
  features: number;
  overall: MetricSet;
  highConfidence: { displayed: number; falsePositive: number; falsePositiveRate: number };
  sharedInfrastructure: { total: number; falsePromotions: number; falsePromotionRate: number };
  ambiguity: { total: number; wrongOwnership: number; wrongOwnershipRate: number };
  byRelation: { OWNS: MetricSet; DEPENDS_ON: MetricSet };
  failures: MappingFailure[];
}

export interface BenchmarkOptions {
  /** Fresh DB path; a temp path is created when omitted. */
  dbPath?: string;
  highConfidenceThreshold?: number;
}

function emptyMetric(): MetricSet {
  return { precision: 1, recall: 1, truePositive: 0, falsePositive: 0, falseNegative: 0 };
}

function finish(m: MetricSet): MetricSet {
  const positive = m.truePositive + m.falsePositive;
  const expected = m.truePositive + m.falseNegative;
  return {
    ...m,
    precision: positive === 0 ? 1 : m.truePositive / positive,
    recall: expected === 0 ? 1 : m.truePositive / expected,
  };
}

function toPrediction(c: CandidateDto): BenchmarkPrediction {
  return {
    candidateId: c.targetId,
    targetType: c.targetType,
    relation: c.relation === 'owns' ? 'OWNS' : 'DEPENDS_ON',
    status: c.status,
    score: c.score,
    distance: c.distance,
    fanIn: c.fanIn,
  };
}

export async function runMappingBenchmark(
  fixtureRoot: string,
  options: BenchmarkOptions = {},
): Promise<MappingBenchmarkResult> {
  const spec = loadMappingBenchmark(fixtureRoot);
  const threshold = options.highConfidenceThreshold ?? HIGH_CONFIDENCE_THRESHOLD;
  const scan = await runScan(fixtureRoot, { dbPath: options.dbPath });
  return evaluateBenchmark({ fixture: fixtureRoot, spec, scan, threshold });
}

export interface EvaluateInput {
  fixture: string;
  spec: MappingBenchmarkSpec;
  scan: ScanJsonOutput;
  threshold?: number;
}

/** Pure evaluation over an already-produced scan — deterministic and testable. */
export function evaluateBenchmark(input: EvaluateInput): MappingBenchmarkResult {
  const fixture = input.fixture;
  const threshold = input.threshold ?? HIGH_CONFIDENCE_THRESHOLD;
  const overall = emptyMetric();
  const byRelation: Record<BenchmarkRelation, MetricSet> = { OWNS: emptyMetric(), DEPENDS_ON: emptyMetric() };
  const highConfidence = { displayed: 0, falsePositive: 0, falsePositiveRate: 0 };
  const shared = { total: 0, falsePromotions: 0, falsePromotionRate: 0 };
  const ambiguity = { total: 0, wrongOwnership: 0, wrongOwnershipRate: 0 };
  const failures: MappingFailure[] = [];
  let featureCount = 0;

  const sharedInfraEntities = (input.spec.entities ?? []).filter((e) => e.tags.includes('shared-infra'));
  shared.total = sharedInfraEntities.length;

  // Preload all feature predictions once.
  const predictionsByFeature = new Map<string, BenchmarkPrediction[]>();
  for (const c of input.scan.candidates) {
    if (c.status === 'rejected') continue;
    const list = predictionsByFeature.get(c.featureId) ?? [];
    list.push(toPrediction(c));
    predictionsByFeature.set(c.featureId, list);
  }

  for (const feature of input.spec.features) {
    featureCount += 1;
    const featureId = normalizeFeatureId(feature.id);
    const predictions = predictionsByFeature.get(featureId) ?? [];
    const predicted = new Map<string, BenchmarkPrediction>(predictions.map((p) => [p.candidateId, p]));

    // Resolved ground truth with tolerant matching. A file target matches
    // the file candidate or any symbol candidate inside it; a symbol
    // target matches its exact candidate, a file-level candidate for the
    // same path, or a symbol whose id starts with `path:name` (engine
    // emits qualified ids like `LoginPage:LoginPage` for React).
    const expected = feature.expected.map((m) => ({
      relation: m.relation,
      confidenceClass: m.confidenceClass,
      tags: m.tags ?? [],
      target: m.target,
    }));
    const notExpected = (feature.notExpected ?? []).map((m) => ({
      relation: m.relation,
      confidenceClass: m.confidenceClass,
      tags: m.tags ?? [],
      target: m.target,
    }));
    const matchesExpected = (candidateId: string): boolean =>
      expected.some((e) => matchesTarget(candidateId, e.target));
    const notExpectedMatchFor = (candidateId: string): (typeof notExpected)[number] | undefined =>
      notExpected.find((n) => matchesTarget(candidateId, n.target));
    const predictedIds = [...predicted.keys()];

    // Precision / recall.
    for (const exp of expected) {
      const tp = predictedIds.some((id) => matchesTarget(id, exp.target));
      if (tp) {
        overall.truePositive += 1;
        byRelation[exp.relation].truePositive += 1;
      } else {
        overall.falseNegative += 1;
        byRelation[exp.relation].falseNegative += 1;
        failures.push({
          fixture,
          type: 'false_negative',
          featureId,
          target: exp.target,
          expected: exp.relation,
          tags: exp.tags,
        });
      }
    }
    for (const id of predictedIds) {
      if (matchesExpected(id)) continue;
      const pred = predicted.get(id)!;
      overall.falsePositive += 1;
      byRelation[pred.relation].falsePositive += 1;
      const notExp = notExpectedMatchFor(id);
      failures.push({
        fixture,
        type: 'false_positive',
        featureId,
        target: notExp?.target ?? { type: pred.targetType, path: id, symbol: id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : undefined },
        actual: pred.relation,
        score: pred.score,
        distance: pred.distance,
        fanIn: pred.fanIn,
        tags: notExp?.tags ?? [],
      });
    }

    // High-confidence safety: a hard negative that reached high confidence.
    const hcPredicted = predictions.filter((p) => p.score >= threshold);
    highConfidence.displayed += hcPredicted.length;
    for (const p of hcPredicted) {
      const notExp = notExpectedMatchFor(p.candidateId);
      if (!notExp) continue;
      highConfidence.falsePositive += 1;
      failures.push({
        fixture,
        type: 'high_confidence_false_positive',
        featureId,
        target: notExp.target,
        expected: notExp.relation,
        actual: p.relation,
        score: p.score,
        distance: p.distance,
        fanIn: p.fanIn,
        tags: notExp.tags,
      });
    }

    // Shared-infrastructure promotion: a shared-infra entity as high-confidence OWNS.
    for (const entity of sharedInfraEntities) {
      const pred = predictions.find(
        (p) => matchesTarget(p.candidateId, entity.target) && p.relation === 'OWNS' && p.score >= threshold,
      );
      if (!pred) continue;
      shared.falsePromotions += 1;
      failures.push({
        fixture,
        type: 'shared_infra_promotion',
        featureId,
        target: entity.target,
        expected: 'not-OWNS',
        actual: pred.relation,
        score: pred.score,
        distance: pred.distance,
        fanIn: pred.fanIn,
        tags: entity.tags,
      });
    }

    // Cross-feature wrong ownership / ownership inflation. The pool is
    // every relation that must NOT be owned: expected DEPENDS_ON and all
    // notExpected hard negatives. Any of them surfacing as OWNS (esp.
    // high-confidence OWNS) is ownership inflation.
    const ambiguityPool = [
      ...expected.filter((e) => e.relation === 'DEPENDS_ON').map((e) => ({ target: e.target, tags: e.tags, expected: 'DEPENDS_ON' as const })),
      ...notExpected.map((n) => ({ target: n.target, tags: n.tags, expected: n.relation })),
    ];
    for (const item of ambiguityPool) {
      const pred = predictions.find((p) => matchesTarget(p.candidateId, item.target) && p.relation === 'OWNS');
      if (!pred) continue;
      ambiguity.total += 1;
      if (pred.score >= threshold) {
        ambiguity.wrongOwnership += 1;
        failures.push({
          fixture,
          type: 'wrong_ownership',
          featureId,
          target: item.target,
          expected: item.expected,
          actual: 'OWNS',
          score: pred.score,
          distance: pred.distance,
          fanIn: pred.fanIn,
          tags: item.tags,
        });
      }
    }
  }

  overall.precision = overall.truePositive + overall.falsePositive === 0 ? 1 : overall.truePositive / (overall.truePositive + overall.falsePositive);
  overall.recall = overall.truePositive + overall.falseNegative === 0 ? 1 : overall.truePositive / (overall.truePositive + overall.falseNegative);
  byRelation.OWNS = finish(byRelation.OWNS);
  byRelation.DEPENDS_ON = finish(byRelation.DEPENDS_ON);
  highConfidence.falsePositiveRate = highConfidence.displayed === 0 ? 0 : highConfidence.falsePositive / highConfidence.displayed;
  shared.falsePromotionRate = shared.total === 0 ? 0 : shared.falsePromotions / shared.total;
  ambiguity.wrongOwnershipRate = ambiguity.total === 0 ? 0 : ambiguity.wrongOwnership / ambiguity.total;

  return {
    fixture,
    features: featureCount,
    overall,
    highConfidence,
    sharedInfrastructure: shared,
    ambiguity,
    byRelation,
    failures,
  };
}

/**
 * Tolerant target matching (Milestone 26 §Stage 5 — benchmark side).
 * A file target matches the file candidate or any symbol inside it; a
 * symbol target matches its exact candidate, a file-level candidate for
 * the same path, or a qualified id prefix (`path:name:*`).
 */
export function matchesTarget(candidateId: string, target: BenchmarkTarget): boolean {
  const { id, path } = resolveTarget(target);
  if (target.type === 'symbol') {
    return candidateId === id || candidateId === path || candidateId.startsWith(`${id}:`);
  }
  return candidateId === path || candidateId.startsWith(`${path}:`);
}
