/**
 * CurrentImpactStore (v0.6.3 plan §6).
 *
 * Repo-scoped in-memory cache of the latest successful snapshot. The
 * snapshot is not a persistent DB fact; a service restart yields
 * `available: false` until the next refresh. Generation guards against
 * stale responses overwriting newer ones.
 */
import type { CurrentImpactSnapshot } from './live-impact-types.js';

export interface ImpactState {
  generation: number;
  snapshot?: CurrentImpactSnapshot;
}

export interface CurrentImpactStore {
  get(repoRoot: string): ImpactState;
  /** Store a fresh snapshot (generation incremented) and return it. */
  save(repoRoot: string, snapshot: CurrentImpactSnapshot): CurrentImpactSnapshot;
}

export function createCurrentImpactStore(): CurrentImpactStore {
  const states = new Map<string, ImpactState>();
  return {
    get(repoRoot) {
      return states.get(repoRoot) ?? { generation: 0 };
    },
    save(repoRoot, snapshot) {
      const state = states.get(repoRoot) ?? { generation: 0 };
      state.generation = state.generation + 1;
      state.snapshot = { ...snapshot, generation: state.generation };
      states.set(repoRoot, state);
      return state.snapshot;
    },
  };
}
