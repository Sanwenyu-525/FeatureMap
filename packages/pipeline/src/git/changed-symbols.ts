/**
 * Changed-symbol extraction (ADR-0004 §2) — Milestone 10.
 *
 * Diff hunk new-side line numbers are intersected with the symbol line
 * spans already stored by the scan:
 *
 *   hunk new-side lines ∩ symbols.startLine..endLine → changed symbol
 *
 * Intersection is a deterministic fact (confidence 1.0). Whether the
 * *match* itself is trustworthy is a separate question answered by the
 * caller (approximate flag when the inspected commit is not HEAD, so
 * the scan-time line spans may have drifted — ADR-0004 §2).
 */
import type { DiffHunk } from './hunks.js';

export interface SymbolSpan {
  symbolId: string;
  name: string;
  path: string;
  kind: string;
  startLine: number;
  endLine: number;
}

export interface ChangedSymbol extends SymbolSpan {
  /** The hunk new-side lines that fall inside this symbol's span. */
  lines: number[];
}

/** Intersect per-file hunks against declared symbol spans (pure). */
export function extractChangedSymbols(hunks: DiffHunk[], spans: SymbolSpan[]): ChangedSymbol[] {
  const changed: ChangedSymbol[] = [];
  for (const span of spans) {
    const lines = hunks
      .filter((h) => h.path === span.path)
      .flatMap((h) => h.newLines)
      .filter((line) => line >= span.startLine && line <= span.endLine)
      .sort((a, b) => a - b);
    if (lines.length === 0) continue;
    changed.push({ ...span, lines });
  }
  return changed;
}