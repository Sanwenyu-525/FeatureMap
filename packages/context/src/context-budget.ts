/**
 * ContextBudget — token-budget selection over the ranked context.
 *
 * Budgeting is NOT string truncation: it allocates IMPORTANCE-weighted
 * budgets per section, picks entries greedily by (tier, rank) inside
 * each section, then redistributes unused budget from satiated sections
 * to hungry ones (core first). Anchors (entry points) have a documented
 * guarantee: they are always kept, because a context without its entry
 * points is useless (spec: "Anchor 始终优先").
 *
 * Default distribution (spec §4):
 *   core 40% · dependencies 20% · tests 15% · policies 10%
 *   recent changes 10% · dependents 3% · risks 2%  (= "Other 5%")
 */
import type {
  CodeEntry,
  ContextOptions,
  FeatureContextBudget,
  PolicyEntry,
  RecentChangeEntry,
  RiskSignal,
} from './types.js';
import type { RankedContext } from './context-ranker.js';

export const DEFAULT_CONTEXT_BUDGET = 8000;
/** Minimum accepted budget — fewer tokens cannot represent a feature. */
export const MIN_CONTEXT_BUDGET = 300;

export const SECTION_WEIGHTS = {
  core: 0.4,
  dependencies: 0.2,
  tests: 0.15,
  policies: 0.1,
  changes: 0.1,
  dependents: 0.03,
  risks: 0.02,
} as const;

export type BudgetSection = keyof typeof SECTION_WEIGHTS;

/** Priority order for budget redistribution (most important first). */
const REDISTRIBUTION_ORDER: BudgetSection[] = [
  'core',
  'dependencies',
  'tests',
  'policies',
  'changes',
  'dependents',
  'risks',
];

export interface BudgetedContext extends RankedContext {
  budget: FeatureContextBudget;
  truncationNote?: string;
}

function selectionPass(
  pool: Array<{ estimatedTokens: number }>,
  allocation: number,
): boolean[] {
  const selected = new Array<boolean>(pool.length).fill(false);
  let used = 0;
  for (let i = 0; i < pool.length; i += 1) {
    const tokens = pool[i]!.estimatedTokens;
    if (tokens <= 0) continue;
    if (used + tokens <= allocation) {
      selected[i] = true;
      used += tokens;
    }
  }
  return selected;
}

/**
 * Apply the token budget to ranked sections. Overflows can only happen
 * through the anchor guarantee (documented, rare).
 */
export function applyBudget(
  ranked: RankedContext,
  options: Pick<ContextOptions, 'budget' | 'includeHistory' | 'includeTests'>,
): BudgetedContext {
  const requested = Math.max(MIN_CONTEXT_BUDGET, Math.round(options.budget ?? DEFAULT_CONTEXT_BUDGET));
  const includeHistory = options.includeHistory ?? true;
  const includeTests = options.includeTests ?? true;

  // ---- pools (already ranked by the ranker) ----------------------------
  const poolOf = (quality: () => unknown[]): Array<{ estimatedTokens: number }> => quality() as Array<{ estimatedTokens: number }>;
  const pools: Record<BudgetSection, Array<{ estimatedTokens: number }>> = {
    core: poolOf(() => [...ranked.entryPoints, ...ranked.coreCode]),
    dependencies: ranked.dependencies,
    tests: includeTests ? ranked.tests : [],
    policies: ranked.policies,
    changes: includeHistory ? ranked.recentChanges : [],
    dependents: ranked.dependents,
    risks: includeHistory ? ranked.changeRisks : [],
  };
  // Output arrays are filtered in lockstep with the pools.
  const sourceOf = (section: BudgetSection): unknown[] => {
    switch (section) {
      case 'core':
        return [...ranked.entryPoints, ...ranked.coreCode];
      case 'dependencies':
        return ranked.dependencies;
      case 'tests':
        return includeTests ? ranked.tests : [];
      case 'policies':
        return ranked.policies;
      case 'changes':
        return includeHistory ? ranked.recentChanges : [];
      case 'dependents':
        return ranked.dependents;
      case 'risks':
        return includeHistory ? ranked.changeRisks : [];
    }
  };

  // ---- initial importance-weighted allocation --------------------------
  const allocation = (Object.keys(SECTION_WEIGHTS) as BudgetSection[]).reduce(
    (acc, section) => {
      acc[section] = Math.round(requested * SECTION_WEIGHTS[section]);
      return acc;
    },
    {} as Record<BudgetSection, number>,
  );
  if (!includeHistory) allocation.changes = 0;
  if (!includeTests) allocation.tests = 0;

  // ---- anchor guarantee -------------------------------------------------
  // Entry points are always kept (spec: anchors first). Their tokens are
  // charged to the core allocation; a tiny budget may overshoot by the
  // entry-point cost — documented, never silently dropped.
  const entryPointTokens = ranked.entryPoints.reduce((s, e) => s + e.estimatedTokens, 0);
  const coreAllocation = Math.max(allocation.core, entryPointTokens);

  const selections: Record<BudgetSection, boolean[]> = {
    core: selectionPass(pools.core, coreAllocation),
    dependencies: [],
    tests: [],
    policies: [],
    changes: [],
    dependents: [],
    risks: [],
  };
  // Entry points are force-included regardless of the pass result.
  for (let i = 0; i < ranked.entryPoints.length; i += 1) {
    selections.core[i] = true;
  }

  for (const section of REDISTRIBUTION_ORDER) {
    if (section === 'core') continue;
    selections[section] = selectionPass(pools[section], allocation[section]);
  }

  // ---- dynamic redistribution of unused budget --------------------------
  const usedTokens = (section: BudgetSection): number =>
    pools[section].reduce((sum, item, i) => (selections[section][i] ? sum + item.estimatedTokens : sum), 0);
  const totalAllocation = (Object.values(allocation) as number[]).reduce((a, b) => a + b, 0);

  for (let iter = 0; iter < 3; iter += 1) {
    const totalUsed = REDISTRIBUTION_ORDER.reduce((sum, s) => sum + usedTokens(s), 0);
    const leftover = totalAllocation - totalUsed;
    if (leftover < 8) break;
    let moved = 0;
    for (const section of REDISTRIBUTION_ORDER) {
      if (section === 'core') continue;
      if (leftover - moved < 8) break;
      const next = pools[section]
        .map((item, i) => ({ item, i }))
        .filter(({ i }) => !selections[section][i])
        .sort((a, b) => a.item.estimatedTokens - b.item.estimatedTokens)[0];
      if (!next || next.item.estimatedTokens > leftover - moved) continue;
      allocation[section] += next.item.estimatedTokens;
      const before = usedTokens(section);
      selections[section] = selectionPass(pools[section], allocation[section]);
      moved += usedTokens(section) - before;
    }
    if (moved < 1) break;
  }

  // ---- materialize ------------------------------------------------------
  const pick = (section: BudgetSection): unknown[] =>
    sourceOf(section).filter((_, i) => selections[section][i]);

  const rankedCount = (section: BudgetSection): number => sourceOf(section).length;
  const droppedIdsAll: string[] = [];
  for (const section of REDISTRIBUTION_ORDER) {
    for (let i = 0; i < rankedCount(section); i += 1) {
      if (!selections[section][i]) droppedIdsAll.push((sourceOf(section)[i] as { id: string }).id);
    }
  }

  const budgetedCore = pick('core') as CodeEntry[];
  const entryPointCount = ranked.entryPoints.length;
  const policies = pick('policies') as PolicyEntry[];
  const constraints = policies.filter((p) => p.level === 'required');

  const sectionTokens = (section: BudgetSection): number => usedTokens(section);
  const estimatedTotal = REDISTRIBUTION_ORDER.reduce((sum, s) => sum + sectionTokens(s), 0);
  const exhaustedSections = REDISTRIBUTION_ORDER.filter(
    (s) => sourceOf(s).some((_, i) => !selections[s][i]),
  );

  const budget: FeatureContextBudget = {
    requested,
    estimatedTotal,
    allocation: { ...allocation },
    overBudget: droppedIdsAll.length > 0,
    dropped: droppedIdsAll,
    exhaustedSections,
  };

  return {
    ...ranked,
    entryPoints: budgetedCore.slice(0, entryPointCount),
    coreCode: budgetedCore.slice(entryPointCount),
    dependencies: pick('dependencies') as CodeEntry[],
    dependents: pick('dependents') as CodeEntry[],
    tests: pick('tests') as CodeEntry[],
    policies,
    constraints,
    recentChanges: pick('changes') as RecentChangeEntry[],
    changeRisks: pick('risks') as RiskSignal[],
    budget,
    truncationNote:
      droppedIdsAll.length > 0
        ? `预算 ${requested} tokens：${droppedIdsAll.length} 个低优先级条目被截断（${exhaustedSections.join(', ')}）；使用更大的 --budget 获取完整上下文。`
        : undefined,
  };
}