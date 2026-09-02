/**
 * MCP tool implementations — docs/MCP_SPEC.md.
 *
 * Context is bounded and ranked (MCP_SPEC §4): deterministic direct
 * implementation evidence first, then high-confidence inferred
 * mappings, instructions, tests, changes, documents. Low-confidence
 * peripheral files never fill the context budget. The server never
 * exposes .env contents, secrets, or unrelated source (MCP_SPEC §6).
 */
import { eq, sql } from 'drizzle-orm';
import { isSurfaceable } from '@featuremap/core';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { analyzeImpact, explainCandidate } from '@featuremap/pipeline';
import { buildFeatureContext, documentFromContext, type CodeEntry, type ContextEvidence, type FeatureContext } from '@featuremap/context';

export interface ToolContext {
  repoRoot: string;
  dbPath?: string;
}

async function withDb<T>(
  ctx: ToolContext,
  fn: (db: ReturnType<typeof openDatabase>['db']) => T | Promise<T>,
): Promise<T> {
  const { db, sqlite } = openDatabase(ctx.dbPath ?? defaultDatabasePath(ctx.repoRoot));
  try {
    return await fn(db);
  } finally {
    sqlite.close();
  }
}

/** list_features — discover available product capabilities. */
export async function listFeatures(
  ctx: ToolContext,
  input: { query?: string; changedOnly?: boolean } = {},
): Promise<unknown> {
  return withDb(ctx, async (db) => {
    let rows = db.select().from(schema.features).all();
    if (input.query) {
      const q = input.query.toLowerCase();
      rows = rows.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.description ?? '').toLowerCase().includes(q) ||
          f.pattern.toLowerCase().includes(q),
      );
    }
    if (input.changedOnly) {
      const impact = await analyzeImpact(ctx.repoRoot, { dbPath: ctx.dbPath });
      const changed = new Set(impact.affectedFeatures.map((f) => f.featureId));
      rows = rows.filter((f) => changed.has(f.id));
    }
    return rows.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? undefined,
      pattern: f.pattern,
      confidence: f.confidence,
    }));
  });
}

/** get_feature — concise feature metadata. */
export async function getFeature(ctx: ToolContext, input: { featureId: string }): Promise<unknown> {
  return withDb(ctx, (db) => {
    const f = db
      .select()
      .from(schema.features)
      .where(eq(schema.features.id, input.featureId))
      .all()[0];
    if (!f) return { error: { code: 'FEATURE_NOT_FOUND', message: `Unknown feature: ${input.featureId}` } };
    return {
      id: f.id,
      name: f.name,
      description: f.description ?? undefined,
      pattern: f.pattern,
      confidence: f.confidence,
      status: f.status,
      health: (f.health ?? undefined) as Record<string, string> | undefined,
    };
  });
}

const ALL_SECTIONS = ['flow', 'code', 'apis', 'data', 'tests', 'documents', 'instructions', 'changes'] as const;

/** Error envelope shared by every tool (same shape as FEATURE_NOT_FOUND below). */
function toError(err: unknown): { error: { code: string; message: string } } {
  const e = err as { code?: string; message?: string };
  return {
    error: {
      code: e.code && typeof e.code === 'string' ? e.code : 'INTERNAL',
      message: e.message ?? String(err),
    },
  };
}

/** Compact stable projection of a CodeEntry for MCP output. */
function entryView(e: CodeEntry): Record<string, unknown> {
  return {
    id: e.id,
    type: e.kind,
    file: e.file ?? null,
    name: e.name ?? null,
    symbol: e.name ?? null,
    symbolType: e.symbolType ?? null,
    role: e.role,
    status: e.status ?? null,
    isAnchor: e.isAnchor,
    distance: e.distance,
    fanIn: e.fanIn,
    score: e.score,
    tier: e.tier,
    confidence: e.confidence,
    relations: e.relations,
    taskMatched: e.taskMatched ?? false,
    evidence: e.evidence.map((ev) => ({
      analyzerId: ev.analyzerId,
      origin: ev.origin,
      confidence: ev.confidence,
      relationType: ev.relationType ?? null,
    })),
  };
}

function evidenceView(evidence: ContextEvidence[]): Array<Record<string, unknown>> {
  return evidence.map((ev) => ({
    analyzerId: ev.analyzerId,
    origin: ev.origin,
    confidence: ev.confidence,
    relationType: ev.relationType ?? null,
    sourceId: ev.sourceId ?? null,
    targetId: ev.targetId ?? null,
    note: ev.note ?? null,
  }));
}

export { evidenceView };

/** Build a FeatureContext through the shared public API (adapter, MCP_SPEC §4). */
function contextOf(
  ctx: ToolContext,
  featureId: string,
  input: { budget?: number; task?: string; includeHistory?: boolean; includeTests?: boolean } = {},
): FeatureContext {
  return buildFeatureContext(ctx.repoRoot, featureId, {
    format: 'json',
    budget: input.budget,
    task: input.task,
    includeHistory: input.includeHistory,
    includeTests: input.includeTests,
    dbPath: ctx.dbPath,
  });
}

/**
 * get_feature_context — primary agent context tool (MCP_SPEC §3).
 * Delegates to @featuremap/context (Phase 5 builder); the old
 * include/maxItemsPerSection arguments remain accepted for
 * backward compatibility and cap the returned sections.
 */
export async function getFeatureContext(
  ctx: ToolContext,
  input: {
    featureId: string;
    include?: Array<(typeof ALL_SECTIONS)[number]>;
    maxItemsPerSection?: number;
    budget?: number;
    task?: string;
  },
): Promise<unknown> {
  try {
    const c = contextOf(ctx, input.featureId, { budget: input.budget, task: input.task });
    const max = input.maxItemsPerSection ?? 20;
    const section = <T>(enabled: boolean, items: T[]): T[] => (enabled ? items.slice(0, max) : []);
    const include = input.include ?? [...ALL_SECTIONS];
    return {
      feature: { id: c.feature.id, name: c.feature.name, pattern: c.feature.pattern, confidence: c.feature.confidence },
      health: c.feature.health ?? null,
      purpose: c.purpose ?? null,
      sections: {
        code: section(include.includes('code'), c.coreCode.map(entryView)),
        apis: section(include.includes('apis'), c.entryPoints.map(entryView)),
        data: section(
          include.includes('data'),
          c.coreCode.filter((e) => e.kind === 'data_entity').map(entryView),
        ),
        tests: section(include.includes('tests'), c.tests.map(entryView)),
        documents: section(include.includes('documents'), c.policies.map((p) => p.source)),
        instructions: section(
          include.includes('instructions'),
          c.policies.map((p) => ({ text: p.text, level: p.level, source: p.source, scope: p.scope ?? null })),
        ),
        changes: section(include.includes('changes'), c.recentChanges),
      },
      risks: c.changeRisks,
      budget: c.budget,
      evidence: c.evidence,
      truncationNote: c.truncationNote ?? null,
      // Canonical cross-surface document (v0.7.0, Milestone 25 §Stage 3):
      // the same FeatureContextDocument the CLI / IDE / HTTP produce,
      // so agents get the portable markdown + Recommended Files from the
      // single canonical renderer — never a second presentation.
      document: documentFromContext(c, input.task),
    };
  } catch (err) {
    return toError(err);
  }
}

/** get_related_code — the ranked code an agent should read first. */
export async function getRelatedCode(
  ctx: ToolContext,
  input: { featureId: string; budget?: number; task?: string; maxItems?: number },
): Promise<unknown> {
  try {
    const c = contextOf(ctx, input.featureId, { budget: input.budget, task: input.task });
    const items = [...c.entryPoints, ...c.coreCode, ...c.dependencies];
    const top = items.slice(0, input.maxItems ?? 30).map(entryView);
    return {
      feature: { id: c.feature.id, name: c.feature.name },
      recommendedFilesToInspect: top
        .map((e) => e['file'] as string | null)
        .filter((f): f is string => !!f)
        .slice(0, 12),
      code: top,
    };
  } catch (err) {
    return toError(err);
  }
}

/** get_feature_dependencies — what this feature depends on (deps + dependents). */
export async function getFeatureDependencies(
  ctx: ToolContext,
  input: { featureId: string; budget?: number; includeDependents?: boolean },
): Promise<unknown> {
  try {
    const c = contextOf(ctx, input.featureId, { budget: input.budget });
    return {
      feature: { id: c.feature.id, name: c.feature.name },
      dependencies: c.dependencies.map(entryView),
      dependents: input.includeDependents === false ? [] : c.dependents.map(entryView),
    };
  } catch (err) {
    return toError(err);
  }
}

/** get_related_tests — tests associated with the feature. */
export async function getRelatedTests(
  ctx: ToolContext,
  input: { featureId: string; budget?: number },
): Promise<unknown> {
  try {
    const c = contextOf(ctx, input.featureId, { budget: input.budget });
    return {
      feature: { id: c.feature.id, name: c.feature.name },
      tests: c.tests.map(entryView),
      // Deterministic note: a recommendation, never a coverage claim.
      note: c.tests.length > 0 ? undefined : '该功能没有已关联的测试文件（可能是扫描时未检测到，或确实缺失）。',
    };
  } catch (err) {
    return toError(err);
  }
}

/** get_change_impact — features affected by the current Git diff (impact API). */
export async function getChangeImpact(
  ctx: ToolContext,
  input: { base?: string; range?: string; minimumConfidence?: number } = {},
): Promise<unknown> {
  try {
    const impact = await analyzeImpact(ctx.repoRoot, {
      range: input.range ?? input.base,
      dbPath: ctx.dbPath,
    });
    const min = input.minimumConfidence ?? 0.5;
    return {
      affectedFeatures: impact.affectedFeatures
        .filter((f) => f.confidence >= min)
        .map((f) => ({
          featureId: f.featureId,
          featureName: f.featureName,
          confidence: f.confidence,
          severity: f.severity,
          reasons: f.reasons,
          tests: f.tests,
        })),
      sharedInfrastructure: impact.sharedInfrastructure,
      suppressedUncertainty: impact.suppressedUncertainty,
      recommendedTests: impact.recommendedTests,
    };
  } catch (err) {
    return toError(err);
  }
}

/** explain_relation — full evidence chain behind a candidate/relation. */
export async function explainRelation(
  ctx: ToolContext,
  input: { featureId: string; target: string },
): Promise<unknown> {
  try {
    // Adapter: reuse the review workflow's chain when the target is a
    // candidate relation; otherwise fall back to raw evidence edges.
    try {
      const explained = explainCandidate(ctx.repoRoot, input.featureId, input.target, ctx.dbPath);
      return {
        featureId: explained.featureId,
        targetId: explained.targetId,
        targetType: explained.targetType,
        relation: explained.relation,
        status: explained.status,
        score: explained.score,
        distance: explained.distance,
        fanIn: explained.fanIn,
        chain: explained.chain,
        fingerprint: explained.fingerprint,
      };
    } catch {
      // Fallback: match evidence edges touching the feature.
      return withDb(ctx, (db) => {
        const rows = db
          .select()
          .from(schema.evidence)
          .where(
            sql`${schema.evidence.targetType} = 'feature' and (${schema.evidence.sourceId} = ${input.target} or ${schema.evidence.targetId} = ${input.target})`,
          )
          .all()
          .map((e) => ({
            sourceId: e.sourceId,
            relationType: e.relationType,
            targetId: e.targetId,
            confidence: e.confidence,
            analyzerId: e.analyzerId,
            origin: e.origin,
          }));
        if (rows.length === 0) {
          return { error: { code: 'RELATION_NOT_FOUND', message: `No relation for "${input.target}" on feature ${input.featureId}.` } };
        }
        return {
          featureId: input.featureId,
          target: input.target,
          evidenceRows: rows,
        };
      });
    }
  } catch (err) {
    return toError(err);
  }
}

/** get_affected_features — analyze the current Git diff (MCP_SPEC §3). */
export async function getAffectedFeatures(
  ctx: ToolContext,
  input: { base?: string; minimumConfidence?: number } = {},
): Promise<unknown> {
  // `base` (if given) doubles as a commit-range change source (ADR-0004 §1).
  const impact = await analyzeImpact(ctx.repoRoot, { range: input.base, dbPath: ctx.dbPath });
  const min = input.minimumConfidence ?? 0.5;
  return impact.affectedFeatures
    .filter((f) => f.confidence >= min && isSurfaceable(f.confidence))
    .map((f) => ({
      featureId: f.featureId,
      featureName: f.featureName,
      confidence: f.confidence,
      changedAssets: impact.changedFiles.map((c) => c.path).slice(0, 20),
      reasons: f.reasons,
    }));
}

/** get_applicable_instructions — scoped repository rules (MCP_SPEC §3). */
export async function getApplicableInstructions(
  ctx: ToolContext,
  input: { featureId: string },
): Promise<unknown> {
  return withDb(ctx, (db) => {
    const rows = db
      .select()
      .from(schema.featureInstructions)
      .where(eq(schema.featureInstructions.featureId, input.featureId))
      .all()
      .flatMap((fi) => {
        const instruction = db
          .select()
          .from(schema.instructions)
          .where(eq(schema.instructions.id, fi.instructionId))
          .all()[0];
        if (!instruction) return [];
        const doc = db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, instruction.documentId))
          .all()[0];
        return [
          {
            text: instruction.text,
            level: instruction.level,
            source: doc?.path ?? instruction.documentId,
            scope: instruction.scope ?? undefined,
          },
        ];
      });
    return rows;
  });
}
