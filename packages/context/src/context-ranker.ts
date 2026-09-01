/**
 * ContextRanker — turns raw graph facts into ranked, tiered entries.
 *
 * Precision-first: a feature's whole closure is never dumped wholesale;
 * entries are ordered by deterministic rules and each lands in one of
 * four tiers:
 *
 *   Tier 1 — feature core implementation (anchors, accepted/declared owns)
 *   Tier 2 — direct dependencies (distance ≤ 1, high confidence)
 *   Tier 3 — important influence relations (dependents, distance ≤ 2)
 *   Tier 4 — background information (distance 3, low confidence)
 *
 * Ranking priorities (in order): anchor status, relation status
 * (human-confirmed > inferred), relation kind (owns > DEPENDS_ON),
 * graph distance, fan-in penalty (shared infrastructure), recent-change
 * relevance, then task-aware boosts. Task boosts move entries within a
 * tier — they never promote an entry above a higher-priority tier.
 */
import type {
  CodeEntry,
  ContextOptions,
  ContextTier,
  PolicyEntry,
  RecentChangeEntry,
  RiskBand,
  RiskSignal,
} from './types.js';
import { estimateTokens } from './tokens.js';
import type { FeatureFacts } from './context-resolver.js';

/** Fan-in at/above which a file is treated as shared infrastructure. */
export const SHARED_INFRA_FAN_IN = 3;

/** Task term boost values (rule-based; the LLM is NOT required). */
export const TASK_BOOST_DIRECT = 0.4;
export const TASK_BOOST_SOFT = 0.2;
export const TASK_BOOST_MAX = 0.6;

/** Human-confirmed statuses outrank inferred suggestions. */
const STATUS_WEIGHT: Record<'declared' | 'suggested' | 'accepted', number> = {
  declared: 1,
  accepted: 1,
  suggested: 0.85,
};

/** Owned implementation outranks plain dependency direction. */
const RELATION_WEIGHT: Record<'owns' | 'DEPENDS_ON', number> = { owns: 1, DEPENDS_ON: 0.55 };

const ANCHOR_BONUS = 0.15;
const RECENT_BOOST = 0.1;

export interface TaskTerms {
  text: string;
  terms: string[];
}

export interface RankedContext {
  entryPoints: CodeEntry[];
  coreCode: CodeEntry[];
  dependencies: CodeEntry[];
  dependents: CodeEntry[];
  tests: CodeEntry[];
  policies: PolicyEntry[];
  constraints: PolicyEntry[];
  recentChanges: RecentChangeEntry[];
  changeRisks: RiskSignal[];
  task?: TaskTerms & { boostsApplied: number };
}

/** Function words never become task terms. */
const STOP_TERMS = new Set([
  'with', 'the', 'and', 'for', 'after', 'this', 'that', 'from', 'into', 'when', 'about', 'were', 'was',
]);

/** Split a task description into lowercase terms (length ≥ 3, no stop words). */
export function extractTaskTerms(task: string | undefined): TaskTerms | undefined {
  if (!task) return undefined;
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !STOP_TERMS.has(w));
  const terms = [...new Set(words)];
  return terms.length > 0 ? { text: task, terms } : undefined;
}

/** Does `haystack` contain `term` as a whole path segment or word boundary? */
function directMatch(haystack: string, term: string): boolean {
  const re = new RegExp(`(^|[/_.-])${term}([/_.-]|$)`, 'i');
  return re.test(haystack);
}

/** Task boost for one code entry (0..TASK_BOOST_MAX). Deterministic only. */
export function taskBoostFor(
  entry: Pick<CodeEntry, 'file' | 'name' | 'relations'>,
  task?: TaskTerms,
): number {
  if (!task || task.terms.length === 0) return 0;
  let boost = 0;
  const pathText = `${entry.file ?? ''}/${entry.name ?? ''}`;
  for (const term of task.terms) {
    if (directMatch(pathText, term)) {
      boost += TASK_BOOST_DIRECT;
    } else if (pathText.includes(term)) {
      boost += TASK_BOOST_SOFT;
    } else if (entry.relations.some((r) => r.toLowerCase().includes(term))) {
      boost += TASK_BOOST_SOFT;
    }
  }
  return Math.min(TASK_BOOST_MAX, boost);
}

/** Shared-infrastructure penalty for non-candidate (asset-only) entries. */
function sharedPenalty(fanIn: number | undefined): number {
  if (!fanIn || fanIn < SHARED_INFRA_FAN_IN) return 1;
  return SHARED_INFRA_FAN_IN / fanIn;
}

/** Split a bare symbol id (`path:name`) into file + name. */
export function splitSymbolId(targetId: string): { file: string; name: string } {
  const colon = targetId.indexOf(':');
  if (colon <= 0) return { file: targetId, name: targetId };
  return { file: targetId.slice(0, colon), name: targetId.slice(colon + 1) };
}

function entryTokens(entry: Pick<CodeEntry, 'kind' | 'file' | 'name' | 'symbolType' | 'relations' | 'evidence'>): number {
  const text = [
    entry.kind,
    entry.file ?? '',
    entry.name ?? '',
    entry.symbolType ?? '',
    entry.relations.join(' '),
    entry.evidence
      .map((e) => `${e.analyzerId} ${e.relationType ?? ''} ${e.sourceId ?? ''} ${e.targetId ?? ''}`)
      .join(' '),
  ].join(' ');
  return estimateTokens(text);
}

function tierOf(candidate: {
  relation: 'owns' | 'DEPENDS_ON';
  status?: 'declared' | 'suggested' | 'accepted';
  isAnchor: boolean;
  distance: number;
  confidence: number;
}): ContextTier {
  if (candidate.isAnchor) return 1;
  if (candidate.status === 'declared' || candidate.status === 'accepted') return 1;
  if (candidate.relation === 'owns') {
    if (candidate.distance <= 1) return 1;
    if (candidate.distance <= 2) return 2;
    return 3;
  }
  if (candidate.distance <= 1 && candidate.confidence >= 0.65) return 2;
  if (candidate.distance <= 2) return 3;
  return 4;
}

/** Canonical dedupe keys. */
const fileKey = (path: string): string => `F:${path}`;
const symbolKey = (targetId: string): string => `S:${targetId}`;

function varEvidence(
  featureId: string,
  confidence: number,
  note: string,
): CodeEntry['evidence'] {
  return [
    {
      analyzerId: 'context-resolver',
      origin: confidence >= 1 ? 'deterministic' : 'semantic',
      confidence,
      relationType: 'BELONGS_TO_FEATURE',
      sourceId: featureId,
      targetId: featureId,
      note,
    },
  ];
}

export function rankFacts(facts: FeatureFacts, options: Pick<ContextOptions, 'task' | 'depth'>): RankedContext {
  const task = extractTaskTerms(options.task);
  const maxDepth = options.depth ?? 3;
  const recentPaths = new Set(facts.recentCommits.flatMap((c) => c.changedPaths));
  let boostsApplied = 0;

  // ---- candidate-derived code entries ----------------------------------
  const coreCode: CodeEntry[] = [];
  const dependencies: CodeEntry[] = [];
  const coveredKeys = new Set<string>();

  for (const c of facts.candidates) {
    const base =
      c.score * STATUS_WEIGHT[c.status] * (c.relation === 'owns' ? RELATION_WEIGHT.owns : RELATION_WEIGHT.DEPENDS_ON);
    const recent =
      c.targetType === 'file' ? recentPaths.has(c.targetId) : recentPaths.has(splitSymbolId(c.targetId).file);
    const entry: CodeEntry = {
      id: c.targetId,
      kind: c.targetType === 'symbol' ? 'symbol' : 'file',
      role: c.relation,
      status: c.status,
      isAnchor: c.isAnchor,
      distance: c.distance,
      fanIn: c.fanIn,
      confidence: Math.min(1, c.score),
      recent,
      relations: c.evidenceChain.map((s) => `${s.relationType} ${s.sourceId} → ${s.targetId}`),
      evidence:
        c.evidenceChain.length > 0
          ? c.evidenceChain.map((s, i) => ({
              analyzerId: 'candidates',
              origin: c.status === 'accepted' ? 'manual' : 'deterministic',
              confidence: s.confidence,
              relationType: s.relationType,
              sourceId: s.sourceId,
              targetId: s.targetId,
              note: `evidence chain step ${i + 1}/${c.evidenceChain.length}`,
            }))
          : [
              {
                // Fallback for legacy/minimal rows: the candidate row
                // itself is the deterministic fact.
                analyzerId: 'candidates',
                origin: c.status === 'accepted' ? 'manual' : 'deterministic',
                confidence: c.score,
                relationType: 'BELONGS_TO_FEATURE',
                sourceId: c.targetId,
                targetId: facts.feature.id,
                note: `${c.relation} ${c.status} candidate (score ${c.score.toFixed(3)})`,
              },
            ],
      score: 0,
      tier: 1,
      estimatedTokens: 0,
    };
    if (c.targetType === 'symbol') {
      const info = facts.symbols.get(c.targetId);
      entry.file = info?.path ?? splitSymbolId(c.targetId).file;
      entry.name = info?.name ?? splitSymbolId(c.targetId).name;
      entry.symbolType = info?.kind;
      if (info?.startLine !== undefined && info?.endLine !== undefined) {
        entry.span = `${entry.file}:${info.startLine}-${info.endLine}`;
      }
    } else {
      entry.file = c.targetId;
    }

    const taskBoost = taskBoostFor(entry, task);
    if (taskBoost > 0) boostsApplied += 1;
    entry.score = Number((base + (c.isAnchor ? ANCHOR_BONUS : 0) + (recent ? RECENT_BOOST : 0) + taskBoost).toFixed(4));
    entry.tier = tierOf({
      relation: c.relation,
      status: c.status,
      isAnchor: c.isAnchor,
      distance: c.distance,
      confidence: entry.confidence,
    });
    if (c.distance > maxDepth) entry.tier = 4;
    entry.taskMatched = taskBoost > 0;
    entry.estimatedTokens = entryTokens(entry);

    const key = c.targetType === 'file' ? fileKey(c.targetId) : symbolKey(c.targetId);
    coveredKeys.add(key);
    (c.relation === 'owns' ? coreCode : dependencies).push(entry);
  }

  // A file shown by any candidate (file-level, or as the container of a
  // symbol-level candidate) — or hosting an entry point — must not
  // re-appear as a background "owns" asset: that would duplicate the
  // same code at a lower tier.
  const coveredFiles = new Set<string>();
  for (const c of facts.candidates) {
    coveredFiles.add(c.targetType === 'file' ? c.targetId : splitSymbolId(c.targetId).file);
  }
  for (const a of facts.featureAssets) {
    if ((a.type === 'endpoint' || a.type === 'cli_command') && a.path) {
      coveredFiles.add(a.path);
    }
  }

  // ---- feature_assets not covered by candidates ------------------------
  const entryPoints: CodeEntry[] = [];
  const tests: CodeEntry[] = [];
  for (const a of facts.featureAssets) {
    if (a.type === 'endpoint' || a.type === 'cli_command') {
      const entry: CodeEntry = {
        id: a.assetId,
        kind: a.type,
        role: 'anchor',
        isAnchor: true,
        distance: 0,
        fanIn: 0,
        score: 1,
        tier: 1,
        confidence: 1,
        relations: [a.type === 'endpoint' ? 'API entry point' : 'CLI entry point'],
        evidence: varEvidence(facts.feature.id, a.confidence, `asset ${a.type} belongs to this feature`),
        estimatedTokens: 0,
        recent: a.path ? recentPaths.has(a.path) : false,
      };
      if (a.path) entry.file = a.path;
      if (a.name) entry.name = a.name;
      entry.taskMatched = entryTaskMatched(entry, task);
      entry.estimatedTokens = entryTokens(entry);
      entryPoints.push(entry);
      continue;
    }
    if (a.type === 'test') {
      const entry: CodeEntry = {
        id: a.assetId,
        kind: 'test',
        role: 'owns',
        isAnchor: false,
        distance: 0,
        fanIn: 0,
        score: Number((a.confidence * 0.9).toFixed(4)),
        tier: a.confidence >= 0.9 ? 1 : 2,
        confidence: a.confidence,
        relations: ['test asset associated with this feature'],
        evidence: varEvidence(facts.feature.id, a.confidence, `test asset belongs to this feature`),
        estimatedTokens: 0,
        recent: false,
      };
      if (a.path) entry.file = a.path;
      if (a.name) entry.name = a.name;
      entry.taskMatched = entryTaskMatched(entry, task);
      entry.estimatedTokens = entryTokens(entry);
      tests.push(entry);
      continue;
    }
    if (a.type === 'data_entity') {
      const entry: CodeEntry = {
        id: a.assetId,
        kind: 'data_entity',
        role: 'owns',
        isAnchor: false,
        distance: 0,
        fanIn: 0,
        score: Number((a.confidence * 0.85).toFixed(4)),
        tier: a.confidence >= 0.9 ? 1 : 2,
        confidence: a.confidence,
        relations: ['data entity associated with this feature'],
        evidence: varEvidence(facts.feature.id, a.confidence, `data entity belongs to this feature`),
        estimatedTokens: 0,
        recent: false,
      };
      if (a.path) entry.file = a.path;
      if (a.name) entry.name = a.name;
      entry.taskMatched = entryTaskMatched(entry, task);
      entry.estimatedTokens = entryTokens(entry);
      coreCode.push(entry);
      continue;
    }
    if (a.type === 'symbol') {
      // Symbol assets carry path+name in the same shape as candidates.
      const bare = a.path && a.name ? `${a.path}:${a.name}` : a.name ?? a.assetId;
      const key = symbolKey(bare);
      if (coveredKeys.has(key)) continue;
      coveredKeys.add(key);
      const info = facts.symbols.get(bare);
      const entry: CodeEntry = {
        id: bare,
        kind: 'symbol',
        role: 'owns',
        isAnchor: false,
        distance: 0,
        fanIn: facts.symbolFanIn.get(bare) ?? 0,
        score: Number((a.confidence * sharedPenalty(facts.symbolFanIn.get(bare))).toFixed(4)),
        tier: 3,
        confidence: a.confidence,
        relations: ['symbol asset belonging to this feature'],
        evidence: varEvidence(facts.feature.id, a.confidence, `symbol asset belongs to this feature`),
        estimatedTokens: 0,
        recent: a.path ? recentPaths.has(a.path) : false,
      };
      entry.file = a.path;
      entry.name = a.name ?? info?.name;
      entry.symbolType = info?.kind;
      entry.taskMatched = entryTaskMatched(entry, task);
      entry.estimatedTokens = entryTokens(entry);
      coreCode.push(entry);
      continue;
    }
    // Plain file asset without a candidate row: background ownership,
    // down-weighted when it is shared infrastructure.
    if (a.type !== 'file') continue;
    const key = fileKey(a.path ?? a.assetId);
    if (coveredKeys.has(key) || (a.path && coveredFiles.has(a.path))) continue;
    coveredKeys.add(key);
    const fanIn = facts.fileFanIn.get(a.path ?? '') ?? 0;
    const entry: CodeEntry = {
      id: a.path ?? a.assetId,
      kind: 'file',
      role: 'owns',
      isAnchor: false,
      distance: 0,
      fanIn,
      score: Number((a.confidence * 0.8 * sharedPenalty(fanIn)).toFixed(4)),
      tier: 3,
      confidence: a.confidence,
      relations: ['file asset belonging to this feature (no candidate row)'],
      evidence: varEvidence(facts.feature.id, a.confidence, `file asset belongs to this feature`),
      estimatedTokens: 0,
      recent: a.path ? recentPaths.has(a.path) : false,
    };
    if (a.path) entry.file = a.path;
    if (a.name) entry.name = a.name;
    entry.taskMatched = entryTaskMatched(entry, task);
    entry.estimatedTokens = entryTokens(entry);
    coreCode.push(entry);
  }

  // ---- dependents (reverse impact) -------------------------------------
  const dependents: CodeEntry[] = [];
  const seenDependentFiles = new Set<string>();
  for (const d of facts.dependents) {
    if (seenDependentFiles.has(d.file)) continue;
    seenDependentFiles.add(d.file);
    const recent = recentPaths.has(d.file);
    const entry: CodeEntry = {
      id: `dependent:${d.file}`,
      kind: 'file',
      role: 'DEPENDS_ON',
      isAnchor: false,
      distance: 0,
      fanIn: facts.fileFanIn.get(d.file) ?? 0,
      score: Number((0.5 * d.edgeConfidence + (recent ? RECENT_BOOST : 0)).toFixed(4)),
      tier: 3,
      confidence: d.edgeConfidence,
      relations: [`imports ${d.ownedTarget} (owned file)`],
      evidence: [
        {
          analyzerId: d.analyzerId,
          origin: 'deterministic',
          confidence: d.edgeConfidence,
          relationType: 'IMPORTS',
          sourceId: d.file,
          targetId: d.ownedTarget,
          note: 'file outside this feature imports an owned file',
        },
      ],
      estimatedTokens: 0,
      recent,
    };
    entry.file = d.file;
    entry.taskMatched = entryTaskMatched(entry, task);
    entry.estimatedTokens = entryTokens(entry);
    dependents.push(entry);
  }

  // ---- recent changes --------------------------------------------------
  const recentChanges: RecentChangeEntry[] = facts.recentCommits.map((c) => {
    const taskMatched =
      task && task.terms.length > 0 && task.terms.some((t) => (c.message ?? '').toLowerCase().includes(t));
    return {
      ...c,
      taskMatched,
      estimatedTokens: estimateTokens(`${c.sha} ${c.author} ${c.kind} ${c.message ?? ''} ${c.changedPaths.join(' ')}`),
      evidence: [
        {
          analyzerId: 'context-resolver',
          origin: 'deterministic',
          confidence: 1,
          relationType: 'MODIFIED_BY',
          sourceId: c.sha,
          targetId: facts.feature.id,
          note: `commit touched ${c.changedPaths.length} owned path(s)`,
        },
      ],
    };
  });

  const changeRisks = deriveChangeRisks(facts, coreCode, tests, recentChanges);

  // ---- policies / constraints ------------------------------------------
  for (const p of facts.policies) {
    p.estimatedTokens = estimateTokens(`${p.text} ${p.scope ?? ''} ${p.source}`);
  }
  const constraints = facts.policies.filter((p) => p.level === 'required');

  // ---- deterministic section ordering ----------------------------------
  const bySection = (a: CodeEntry, b: CodeEntry): number =>
    a.tier - b.tier || b.score - a.score || a.id.localeCompare(b.id);
  coreCode.sort(bySection);
  dependencies.sort(bySection);
  tests.sort((a, b) => a.tier - b.tier || b.score - a.score || a.id.localeCompare(b.id));
  entryPoints.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  dependents.sort(bySection);

  return {
    entryPoints,
    coreCode,
    dependencies,
    dependents,
    tests,
    policies: facts.policies,
    constraints,
    recentChanges,
    changeRisks,
    task: task ? { ...task, boostsApplied } : undefined,
  };
}

function entryTaskMatched(entry: { file?: string; name?: string; relations: string[] }, task?: TaskTerms): boolean | undefined {
  if (!task) return undefined;
  return taskBoostFor(entry, task) > 0;
}

/**
 * Deterministic, explainable risk signals for the recent change window —
 * rule table style matching ADR-0005 §2 (bands, never percentages).
 */
export function deriveChangeRisks(
  facts: FeatureFacts,
  coreCode: CodeEntry[],
  tests: CodeEntry[],
  recentChanges: RecentChangeEntry[],
): RiskSignal[] {
  const risks: RiskSignal[] = [];
  const anchorFiles = new Set(
    coreCode.filter((e) => e.isAnchor && e.file).map((e) => e.file as string),
  );
  const recent = recentChanges.slice(0, 5);

  const mark = (id: string, band: RiskBand, reason: string, sha?: string): void => {
    risks.push({
      id,
      band,
      reason,
      estimatedTokens: estimateTokens(reason),
      evidence: [
        {
          analyzerId: 'context-risks',
          origin: 'deterministic',
          confidence: 1,
          relationType: 'MODIFIED_BY',
          sourceId: sha ?? recent[0]?.sha ?? 'recent-window',
          targetId: facts.feature.id,
          note: reason,
        },
      ],
    });
  };

  // 1. Anchors / entry points changed → highest visibility.
  const anchorChanges = recent.filter((c) => c.changedPaths.some((p) => anchorFiles.has(p)));
  if (anchorChanges.length > 0) {
    mark(
      `risk:anchor-changes`,
      'HIGH',
      `入口/锚点文件在近期提交中变更：${anchorChanges.map((c) => c.sha.slice(0, 7)).join(', ')}`,
      anchorChanges[0]?.sha,
    );
  }

  // 2. Shared-infrastructure files inside the feature changed.
  const sharedChanges = recent.filter((c) =>
    c.changedPaths.some((p) => (facts.fileFanIn.get(p) ?? 0) >= SHARED_INFRA_FAN_IN),
  );
  if (sharedChanges.length > 0) {
    mark(
      `risk:shared-infra`,
      'MEDIUM',
      `共享文件（fan-in ≥ ${SHARED_INFRA_FAN_IN}）被变更：${sharedChanges.map((c) => c.sha.slice(0, 7)).join(', ')} — 影响该功能之外的其他消费者`,
      sharedChanges[0]?.sha,
    );
  }

  // 3. fix-kind commits touching core.
  const fixes = recent.filter((c) => c.kind === 'fix');
  if (fixes.length > 0) {
    mark(
      `risk:fix-commits`,
      'MEDIUM',
      `近期 ${fixes.length} 个 fix 提交触及该功能核心：${fixes.map((f) => f.sha.slice(0, 7)).join(', ')}`,
      fixes[0]?.sha,
    );
  }

  // 4. Core changed but related tests did not move (only when tests exist).
  const testPaths = new Set(tests.map((t) => t.file).filter((f): f is string => !!f));
  const testsChanged = recent.some((c) => c.changedPaths.some((p) => testPaths.has(p)));
  if (testPaths.size > 0 && !testsChanged && recent.length > 0) {
    mark(
      `risk:tests-unchanged`,
      'MEDIUM',
      `近期核心代码变更，但相关测试未同步变更—建议运行时验证`,
      recent[0]?.sha,
    );
  }

  return risks;
}