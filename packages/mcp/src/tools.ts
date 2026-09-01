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
import { analyzeImpact } from '@featuremap/pipeline';

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

/**
 * get_feature_context — primary agent context tool (MCP_SPEC §3).
 * Output is bounded by maxItemsPerSection and ranked by evidence strength.
 */
export async function getFeatureContext(
  ctx: ToolContext,
  input: {
    featureId: string;
    include?: Array<(typeof ALL_SECTIONS)[number]>;
    maxItemsPerSection?: number;
  },
): Promise<unknown> {
  const include = input.include ?? [...ALL_SECTIONS];
  const max = input.maxItemsPerSection ?? 20;
  return withDb(ctx, async (db) => {
    const f = db
      .select()
      .from(schema.features)
      .where(eq(schema.features.id, input.featureId))
      .all()[0];
    if (!f) return { error: { code: 'FEATURE_NOT_FOUND', message: `Unknown feature: ${input.featureId}` } };

    const rows = db
      .select()
      .from(schema.featureAssets)
      .where(eq(schema.featureAssets.featureId, f.id))
      .all()
      .flatMap((fa) => {
        const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
        return asset ? [{ asset, confidence: fa.confidence }] : [];
      })
      .filter((r) => isSurfaceable(r.confidence));

    // Ranking: anchors (deterministic direct) first, then high-confidence
    // inferred closure files (MCP_SPEC §4).
    const ranked = [...rows].sort((a, b) => b.confidence - a.confidence);

    const section = <T>(enabled: boolean, items: T[]): T[] => (enabled ? items.slice(0, max) : []);

    const code = section(
      include.includes('code'),
      ranked
        .filter(
          (r) =>
            r.asset.type === 'file' ||
            r.asset.type === 'symbol' ||
            r.asset.type === 'test' ||
            r.asset.type === 'cli_command',
        )
        .map((r) => ({
          type: r.asset.type,
          path: r.asset.path ?? undefined,
          name: r.asset.name ?? undefined,
          confidence: r.confidence,
        })),
    );
    const apis = section(
      include.includes('apis'),
      ranked
        .filter((r) => r.asset.type === 'endpoint')
        .map((r) => ({ name: r.asset.name ?? '', path: r.asset.path ?? undefined })),
    );
    const data = section(
      include.includes('data'),
      ranked
        .filter((r) => r.asset.type === 'data_entity')
        .map((r) => ({ name: r.asset.name ?? '', path: r.asset.path ?? undefined })),
    );
    const tests = section(
      include.includes('tests'),
      ranked
        .filter((r) => r.asset.type === 'test')
        .map((r) => ({ path: r.asset.path ?? '' })),
    );
    const documents = section(
      include.includes('documents'),
      db
        .select()
        .from(schema.featureDocuments)
        .where(eq(schema.featureDocuments.featureId, f.id))
        .all()
        .map((fd) => fd.documentId)
        .slice(0, max),
    );
    // Instruction extraction lands with Milestone 2 follow-up; report
    // empty rather than guessing rules (AGENTS.md §3.2).
    const instructions = section(include.includes('instructions'), [] as string[]);

    let changes: Array<{ path: string; changeType: string }> = [];
    if (include.includes('changes')) {
      const impact = await analyzeImpact(ctx.repoRoot, { dbPath: ctx.dbPath });
      const affected = impact.affectedFeatures.find((af) => af.featureId === f.id);
      changes = affected
        ? impact.changedFiles.filter((c) => changedTouchesFeature(affected.reasons, c.path)).slice(0, max)
        : [];
    }

    const evidenceSummary = db
      .select()
      .from(schema.evidence)
      .where(sql`${schema.evidence.targetType} = 'feature' and ${schema.evidence.targetId} = ${f.id}`)
      .all()
      .slice(0, max)
      .map((e) => ({
        source: e.sourceId,
        confidence: e.confidence,
        analyzerId: e.analyzerId,
      }));

    return {
      feature: { id: f.id, name: f.name, pattern: f.pattern, confidence: f.confidence },
      health: (f.health ?? undefined) as Record<string, string> | undefined,
      sections: { code, apis, data, tests, documents, instructions, changes },
      evidenceSummary,
    };
  });
}

function changedTouchesFeature(reasons: string[], changedPath: string): boolean {
  return reasons.some((r) => r.startsWith(changedPath) || r.includes(` ${changedPath} `));
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
