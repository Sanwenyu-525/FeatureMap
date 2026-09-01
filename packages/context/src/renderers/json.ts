/**
 * JSON Renderer — the stable machine interface.
 *
 * Stability rules: field order is fixed, fields are only ever added
 * (never renamed or removed) while `schemaVersion` is `1`; breaking
 * changes bump `schemaVersion`. This output is intended for tools
 * (CLI --format json, MCP tools, IDE extensions, CI), not humans.
 */
import type { FeatureContext } from '../types.js';
import { CONTEXT_SCHEMA_VERSION } from '../types.js';

/** Render the model as a stable JSON-serializable object. */
export function renderJson(context: FeatureContext): Record<string, unknown> {
  const code = (s: 'entryPoints' | 'coreCode' | 'dependencies' | 'dependents' | 'tests') =>
    context[s].map((e) => ({
      id: e.id,
      kind: e.kind,
      file: e.file,
      name: e.name,
      symbolType: e.symbolType,
      span: e.span,
      role: e.role,
      status: e.status,
      isAnchor: e.isAnchor,
      distance: e.distance,
      fanIn: e.fanIn,
      score: e.score,
      tier: e.tier,
      confidence: e.confidence,
      relations: e.relations,
      recent: e.recent ?? false,
      taskMatched: e.taskMatched ?? false,
      estimatedTokens: e.estimatedTokens,
      evidence: e.evidence.map((ev) => ({
        analyzerId: ev.analyzerId,
        origin: ev.origin,
        confidence: ev.confidence,
        relationType: ev.relationType,
        sourceId: ev.sourceId,
        targetId: ev.targetId,
        note: ev.note,
      })),
    }));

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    generatedBy: context.generatedBy,
    feature: context.feature,
    purpose: context.purpose,
    summary: context.summary,
    task: context.task,
    entryPoints: code('entryPoints'),
    coreCode: code('coreCode'),
    dependencies: code('dependencies'),
    dependents: code('dependents'),
    tests: code('tests'),
    policies: context.policies,
    constraints: context.constraints,
    recentChanges: context.recentChanges,
    risks: context.changeRisks,
    evidence: context.evidence,
    budget: context.budget,
    truncationNote: context.truncationNote,
  };
}