/**
 * Stable target resolver (v0.7.1, Milestone 26 §Stage 0).
 *
 * Turns a benchmark `target` into the canonical candidate-id space the
 * feature-candidate engine emits: files use their path, symbols use
 * `path:name`. Resolving never touches DB-generated ids — the corpus
 * stays stable across rescans. Feature ids normalize to `feature:<slug>`.
 */
import { slugify } from '../feature-discovery.js';
import type { BenchmarkTarget } from './types.js';

/** `login` → `feature:login`; `feature:login` stays as-is. */
export function normalizeFeatureId(id: string): string {
  return id.startsWith('feature:') ? id : `feature:${slugify(id)}`;
}

/** Canonical candidate id for a benchmark target. */
export function resolveTargetId(target: BenchmarkTarget): string {
  if (target.type === 'file') return target.path;
  return `${target.path}:${target.symbol}`;
}

export interface ResolvedTarget {
  /** Canonical candidate id (`path` or `path:symbol`). */
  id: string;
  /** The path is normalized to forward slashes (Windows-safe corpus). */
  path: string;
}

/** Normalize the path and produce the canonical id for comparison. */
export function resolveTarget(target: BenchmarkTarget): ResolvedTarget {
  const path = target.path.replaceAll('\\', '/');
  if (target.type === 'file') return { id: path, path };
  return { id: `${path}:${target.symbol}`, path };
}
