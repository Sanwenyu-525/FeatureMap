/**
 * Unified change source model (ADR-0004 §1) — Milestone 10.
 *
 * All change consumers (impact CLI, API, MCP, timeline) share one
 * abstraction instead of each growing its own argument parsing:
 *
 *   working-tree   — uncommitted changes (git status)
 *   branch-diff    — committed changes vs the configured base branch
 *   commit-range   — a deterministic from..to snapshot pair
 *
 * `featuremap impact` with no argument keeps today's behavior by
 * resolving to working-tree + branch-diff.
 */
export type ChangeSource =
  | { kind: 'working-tree' }
  | { kind: 'branch-diff' }
  | { kind: 'commit-range'; from: string; to: string };

/**
 * Parse a CLI-supplied change description into sources.
 *
 * - no argument           → working-tree + branch-diff (Milestone 4 default)
 * - `HEAD`                → the single most recent commit (HEAD~1..HEAD)
 * - `HEAD~1..HEAD`        → commit-range
 * - any other `<range>` of the form `<from>..<to>` → commit-range
 */
export function parseChangeSources(range?: string): ChangeSource[] {
  const trimmed = range?.trim() ?? '';
  if (trimmed === '') {
    return [{ kind: 'working-tree' }, { kind: 'branch-diff' }];
  }
  if (trimmed === 'HEAD') {
    return [{ kind: 'commit-range', from: 'HEAD~1', to: 'HEAD' }];
  }
  const match = /^(.+)\.\.(.+)$/.exec(trimmed);
  if (match && match[1] && match[2]) {
    return [{ kind: 'commit-range', from: match[1], to: match[2] }];
  }
  // Any other commit-ish means "this one commit": its parent diff.
  return [{ kind: 'commit-range', from: `${trimmed}~1`, to: trimmed }];
}