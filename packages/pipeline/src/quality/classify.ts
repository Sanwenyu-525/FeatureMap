/**
 * Failure classification (v0.7.1, Milestone 26 §Stage 4).
 *
 * First-pass engineering classification of benchmark failures so the
 * optimization target is evidence-driven, not guessed:
 *
 *   deterministic-fixable  a structural rule change can fix it (fan-in,
 *                          distance, shared infra, ownership)
 *   unsupported            the engine does not yet emit this mapping
 *                          (e.g. component-usage traversal to UI files)
 *   annotation-error       the corpus is under-annotated (a candidate is
 *                          neither expected nor a hard negative)
 *   semantic-ambiguous     genuinely needs domain semantics (rare; LLM
 *                          trigger is measured from this bucket later)
 */
import type { MappingFailure } from './benchmark.js';

export type FailureCategory = 'deterministic-fixable' | 'semantic-ambiguous' | 'annotation-error' | 'unsupported';

export const FAILURE_CATEGORIES: FailureCategory[] = [
  'deterministic-fixable',
  'semantic-ambiguous',
  'annotation-error',
  'unsupported',
];

/** UI/component/hook files the endpoint-closure engine cannot yet reach. */
const UI_PATH = /(page\.tsx|LoginForm|LoginPage|useLogin|Button|PasswordInput|components\/|hooks\/)/;

export function classifyFailure(f: MappingFailure): FailureCategory {
  switch (f.type) {
    case 'high_confidence_false_positive':
    case 'shared_infra_promotion':
    case 'wrong_ownership':
      // Scoring / policy bugs — deterministic by construction.
      return 'deterministic-fixable';
    case 'false_negative':
      // Missing relations. UI reachability is an engine gap; everything
      // else is a deterministic traversal/evidence gap (no domain judgment).
      return f.target.path.match(UI_PATH) ? 'unsupported' : 'deterministic-fixable';
    case 'false_positive':
      // An unexpected candidate. Tagged hard negatives are fixable; an
      // untagged candidate is a ground-truth gap (corpus under-annotation).
      return f.tags.some((t) => t === 'shared-infra' || t === 'cross-feature')
        ? 'deterministic-fixable'
        : 'annotation-error';
  }
}

export interface ClassificationSummary {
  byCategory: Record<FailureCategory, number>;
  /** Top failure targets per category, for the report. */
  top: Record<FailureCategory, string[]>;
}

export function classifyFailures(failures: MappingFailure[], topN = 8): ClassificationSummary {
  const byCategory = Object.fromEntries(FAILURE_CATEGORIES.map((c) => [c, 0])) as Record<FailureCategory, number>;
  const top: Record<FailureCategory, string[]> = Object.fromEntries(FAILURE_CATEGORIES.map((c) => [c, []])) as unknown as Record<FailureCategory, string[]>;
  for (const f of failures) {
    const category = classifyFailure(f);
    byCategory[category] += 1;
    const label = `${f.target.type === 'symbol' && f.target.symbol ? `${f.target.path}:${f.target.symbol}` : f.target.path} (${f.type})`;
    if (top[category]!.length < topN && !top[category]!.includes(label)) top[category]!.push(label);
  }
  return { byCategory, top };
}

export function renderClassification(summary: ClassificationSummary): string {
  const out: string[] = ['Failure Classification'];
  for (const c of FAILURE_CATEGORIES) {
    out.push(`  ${c.padEnd(22)} ${summary.byCategory[c]}`);
    for (const t of summary.top[c]!) out.push(`    - ${t}`);
  }
  return out.join('\n');
}
