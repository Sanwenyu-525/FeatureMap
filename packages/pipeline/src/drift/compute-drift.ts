/**
 * Shared drift computation (v0.6.4 plan §4–§5).
 *
 * Pure and deterministic — the single drift engine consumed by both
 * the PR report (ADR-0005) and the IDE `detectDrift`. It is always
 * detect → suggest: it never mutates verdicts or candidates.
 */
import type { DriftIssue, DriftKind, DriftReport } from './drift-types.js';

export interface ConfirmedRelation {
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  status: string;
  score: number;
  fingerprint: string | null;
}

export interface DriftInput {
  /** Accepted / declared candidate relations (user facts + anchors). */
  confirmed: ConfirmedRelation[];
  /** Changed file path → change type (deleted / renamed detected here). */
  changeTypeByPath: Map<string, string>;
  changedSymbols: Array<{ path: string; name: string; symbolId: string }>;
  /** Confirmed ownership: feature → owned file paths. */
  ownedFilesByFeature: Map<string, Set<string>>;
  testPaths: Set<string>;
  featureNames: Map<string, string>;
}

/** Strip a `symbol:` prefix (symbolId ↔ candidate targetId normalization). */
export function bareSymbolId(symbolId: string): string {
  return symbolId.startsWith('symbol:') ? symbolId.slice('symbol:'.length) : symbolId;
}

/** Containing file of a bare symbol targetId (`path:name` → `path`). */
export function containingFileOfSymbol(targetId: string): string | undefined {
  const colon = targetId.indexOf(':');
  return colon > 0 ? targetId.slice(0, colon) : undefined;
}

export function computeDrift(input: DriftInput): DriftIssue[] {
  const { confirmed, changeTypeByPath, changedSymbols, ownedFilesByFeature, testPaths, featureNames } = input;
  const issues: DriftIssue[] = [];
  const seen = new Set<string>();

  // relation_broken: the file behind an accepted/declared relation was
  // deleted or renamed — the mapping can no longer hold.
  for (const c of confirmed) {
    const file = c.targetType === 'file' ? c.targetId : containingFileOfSymbol(c.targetId);
    if (!file) continue;
    const changeType = changeTypeByPath.get(file);
    if (changeType !== 'deleted' && changeType !== 'renamed') continue;
    const key = `${c.featureId}:${c.targetType}:${c.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      id: `relation_broken:${c.featureId}:${c.targetType}:${c.targetId}`,
      kind: 'relation_broken',
      featureId: c.featureId,
      featureName: featureNames.get(c.featureId),
      targetId: c.targetId,
      targetType: c.targetType,
      reason: `已确认的映射目标文件 ${file} ${changeType === 'deleted' ? '已被删除' : '已被重命名'}——该功能的映射可能已过期`,
    });
  }

  // new_candidate: a changed symbol inside a feature-owned file that is
  // not yet an accepted/declared relation. Detect → suggest only.
  const confirmedSymbolIdsByFeature = new Map<string, Set<string>>();
  for (const c of confirmed) {
    if (c.targetType !== 'symbol') continue;
    const set = confirmedSymbolIdsByFeature.get(c.featureId) ?? new Set<string>();
    set.add(c.targetId);
    confirmedSymbolIdsByFeature.set(c.featureId, set);
  }
  for (const sym of changedSymbols) {
    if (testPaths.has(sym.path)) continue;
    const bare = bareSymbolId(sym.symbolId);
    for (const [featureId, files] of ownedFilesByFeature) {
      if (!files.has(sym.path)) continue;
      if (confirmedSymbolIdsByFeature.get(featureId)?.has(bare)) continue;
      const key = `${featureId}:${sym.symbolId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        id: `new_candidate:${featureId}:symbol:${sym.symbolId}`,
        kind: 'new_candidate',
        featureId,
        featureName: featureNames.get(featureId),
        targetId: sym.symbolId,
        targetType: 'symbol',
        reason: `变更符号 ${bare} 位于 ${featureId} 的归属文件 ${sym.path}，但尚未被确认——建议评审（detect → suggest）`,
      });
    }
  }

  return issues;
}

export function summarizeDrift(issues: DriftIssue[]): DriftReport['summary'] {
  const byType: Record<DriftKind, number> = { relation_broken: 0, new_candidate: 0 };
  for (const issue of issues) byType[issue.kind] += 1;
  return { issueCount: issues.length, byType };
}
