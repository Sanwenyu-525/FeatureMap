/**
 * Shared one-line formatting for renderers.
 */

import type { CodeEntry, ContextEvidence } from '../types.js';

/** One dense line describing a code entry for terminal/agent output. */
export function entryLine(e: CodeEntry): string {
  const loc = e.span ?? e.file ?? e.name ?? e.id;
  const name =
    e.name && e.name !== e.file && !loc.includes(e.name)
      ? ` :: ${e.name}${e.symbolType ? ` [${e.symbolType}]` : ''}`
      : e.symbolType
        ? ` [${e.symbolType}]`
        : '';
  const role = e.isAnchor ? 'anchor' : e.role;
  const status = e.status ? ` ${e.status}` : '';
  const conf = e.confidence.toFixed(2);
  const provenance = provenanceOf(e.evidence[0]);
  const flags = [
    e.recent ? 'recent' : undefined,
    e.taskMatched ? 'task' : undefined,
  ]
    .filter((f): f is string => !!f)
    .join(',');
  return `${loc}${name} [${role}${status} t${e.tier}] conf ${conf}${flags ? ` (${flags})` : ''}${provenance}`;
}

/** Distinguish verified facts from inference (agent renderer requirement). */
export function provenanceOf(evidence?: ContextEvidence): string {
  if (!evidence) return '';
  switch (evidence.origin) {
    case 'manual':
      return ' (human-confirmed)';
    case 'semantic':
      return ` (inferred, ${evidence.analyzerId})`;
    default:
      return ` ev:${evidence.analyzerId}/${evidence.confidence.toFixed(2)}`;
  }
}

/** A compact evidence trail for one entry. */
export function evidenceTrail(evidence: ContextEvidence[]): string {
  if (evidence.length === 0) return '';
  const left = evidence.slice(0, 3);
  const trail = left
    .map((e) => `${e.relationType ?? '?'}:${e.sourceId ?? '?'}→${e.targetId ?? '?'}(${e.confidence.toFixed(2)})`)
    .join(' ');
  return evidence.length > 3 ? `${trail} +${evidence.length - 3}` : trail;
}

/** Prefix marker per context tier for visual scanning. */
export const TIER_MARK: Record<number, string> = {
  1: '★',
  2: '◆',
  3: '○',
  4: '·',
};