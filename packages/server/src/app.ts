/**
 * Local Fastify API — docs/API_SPEC.md.
 *
 * Local-only by default; binds to loopback unless explicitly
 * configured. Returns DTOs with evidence and confidence preserved.
 */
import { eq, desc, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { runScan, analyzeImpact } from '@featuremap/pipeline';
import type {
  AnalyzerStatusDto,
  ChangesResponse,
  FeatureDetailDto,
  FeatureListItemDto,
  OverviewResponse,
  ProjectResponse,
} from './dto.js';

export interface BuildServerOptions {
  repoRoot: string;
  dbPath?: string;
}

type FeatureMapDb = ReturnType<typeof openDatabase>['db'];

function fail(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function getProject(db: FeatureMapDb) {
  return db.select().from(schema.projects).limit(1).all()[0];
}

function deriveTechnologies(db: FeatureMapDb) {
  const latestScan = db
    .select()
    .from(schema.scans)
    .orderBy(desc(schema.scans.startedAt))
    .limit(1)
    .all()[0];
  const stats = (latestScan?.stats ?? {}) as { technologies?: Array<{ id: string; confidence: number; source: string }> };
  return stats.technologies ?? [];
}

/** Aggregate derived feature health into per-state counts. */
function aggregateHealth(
  db: FeatureMapDb,
  total: number,
): OverviewResponse['health'] {
  const byState: Record<string, number> = { complete: 0, partial: 0, present: 0, missing: 0, unknown: 0 };
  const rows = db.select().from(schema.features).all();
  for (const row of rows) {
    const health = (row.health ?? {}) as Record<string, string>;
    // A feature counts as healthy when its implementation dimension is
    // complete; unknown when no health was derived.
    const state = health['implementation'] ?? 'unknown';
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return { total, byState: byState as OverviewResponse['health']['byState'] };
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const dbPath = options.dbPath ?? defaultDatabasePath(options.repoRoot);
  const { db, sqlite } = openDatabase(dbPath);

  app.get('/api/project', async (_req, reply) => {
    const project = getProject(db);
    if (!project) {
      return fail(reply, 'PROJECT_NOT_INITIALIZED', 'Run "featuremap init" and "featuremap scan" first.', 404);
    }
    const lastScan = db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.status, 'completed'))
      .orderBy(desc(schema.scans.startedAt))
      .limit(1)
      .all()[0];
    const body: ProjectResponse = {
      name: project.name,
      root: project.root,
      baseBranch: project.baseBranch,
      technologies: deriveTechnologies(db),
      lastScan: lastScan?.finishedAt ?? undefined,
    };
    return body;
  });

  app.get('/api/overview', async (_req, reply) => {
    if (!getProject(db)) {
      return fail(reply, 'PROJECT_NOT_INITIALIZED', 'Run "featuremap init" and "featuremap scan" first.', 404);
    }
    const counts = {
      files: db.select().from(schema.files).all().length,
      endpoints: db.select().from(schema.assets).where(eq(schema.assets.type, 'endpoint')).all().length,
      tests: db.select().from(schema.assets).where(eq(schema.assets.type, 'test')).all().length,
      documents: db.select().from(schema.documents).all().length,
      features: db.select().from(schema.features).all().length,
      instructions: db.select().from(schema.instructions).all().length,
    };
    const workingChanges = db
      .select()
      .from(schema.commitFiles)
      .where(eq(schema.commitFiles.commitSha, 'WORKING_TREE'))
      .all();
    const body: OverviewResponse = {
      counts,
      // Aggregated from derived feature health (docs/DATA_MODEL.md §5),
      // never invented: dimensions missing evidence count as unknown.
      health: aggregateHealth(db, counts.features),
      currentImpact: { changedFiles: workingChanges.length, affectedFeatures: 0 },
    };
    return body;
  });

  app.get('/api/features', async () => {
    const rows = db.select().from(schema.features).all();
    const list: FeatureListItemDto[] = rows.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? undefined,
      pattern: f.pattern,
      confidence: f.confidence,
      status: f.status,
      health: (f.health ?? undefined) as FeatureListItemDto['health'],
      updatedAt: f.updatedAt,
    }));
    return list;
  });

  app.get('/api/features/:id', async (req, reply) => {
    // find-my-way may leave %3A encoded; feature ids contain ':'.
    const id = decodeURIComponent((req.params as { id: string }).id);
    const feature = db.select().from(schema.features).where(eq(schema.features.id, id)).all()[0];
    if (!feature) {
      return fail(reply, 'FEATURE_NOT_FOUND', `Feature "${id}" does not exist.`, 404);
    }
    const featureAssets = db
      .select()
      .from(schema.featureAssets)
      .where(eq(schema.featureAssets.featureId, id))
      .all();
    const assets = featureAssets
      .map((fa) => db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0])
      .filter((a) => a !== undefined)
      .map((a) => ({ id: a.id, type: a.type, path: a.path ?? undefined, name: a.name ?? undefined }));
    const featureDocuments = db
      .select()
      .from(schema.featureDocuments)
      .where(eq(schema.featureDocuments.featureId, id))
      .all();
    const documents = featureDocuments
      .map((fd) =>
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, fd.documentId))
          .all()[0],
      )
      .filter((d) => d !== undefined)
      .map((d) => ({ path: d.path, title: d.title ?? undefined }));
    const evidence = db
      .select()
      .from(schema.evidence)
      .where(sql`${schema.evidence.targetType} = 'feature' and ${schema.evidence.targetId} = ${id}`)
      .all()
      .map((e) => ({
        id: e.id,
        relationType: e.relationType,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        targetType: e.targetType,
        targetId: e.targetId,
        confidence: e.confidence,
        analyzerId: e.analyzerId,
      }));
    const body: FeatureDetailDto = {
      id: feature.id,
      name: feature.name,
      description: feature.description ?? undefined,
      pattern: feature.pattern,
      confidence: feature.confidence,
      status: feature.status,
      updatedAt: feature.updatedAt,
      health: (feature.health ?? undefined) as FeatureDetailDto['health'],
      assets,
      documents,
      evidence,
    };
    return body;
  });

  app.get('/api/features/:id/evidence', async (req, reply) => {
    const id = decodeURIComponent((req.params as { id: string }).id);
    const feature = db.select().from(schema.features).where(eq(schema.features.id, id)).all()[0];
    if (!feature) {
      return fail(reply, 'FEATURE_NOT_FOUND', `Feature "${id}" does not exist.`, 404);
    }
    const evidence = db
      .select()
      .from(schema.evidence)
      .where(sql`${schema.evidence.targetType} = 'feature' and ${schema.evidence.targetId} = ${id}`)
      .all();
    return { featureId: id, evidence };
  });

  app.get('/api/changes', async (_req, reply) => {
    const project = getProject(db);
    if (!project) {
      return fail(reply, 'PROJECT_NOT_INITIALIZED', 'Run "featuremap init" and "featuremap scan" first.', 404);
    }
    // Impact traversal over evidence-backed relations only
    // (AGENTS.md §9); low-confidence hits stay unsurfaced.
    const impact = analyzeImpact(options.repoRoot, dbPath);
    const body: ChangesResponse = {
      currentBranch: impact.currentBranch,
      baseBranch: impact.baseBranch ?? project.baseBranch,
      changedFiles: impact.changedFiles,
      affectedFeatures: impact.affectedFeatures.map((f) => ({
        featureId: f.featureId,
        featureName: f.featureName,
        confidence: f.confidence,
        reasons: f.reasons,
      })),
      potentiallyStaleDocuments: impact.potentiallyStaleDocuments,
    };
    return body;
  });

  app.post('/api/scan', async (req, reply) => {
    const body = (req.body ?? {}) as { mode?: string };
    const mode = body.mode ?? 'incremental';
    if (mode !== 'incremental' && mode !== 'full') {
      return fail(reply, 'INVALID_CONFIG', 'mode must be "incremental" or "full".', 400);
    }
    try {
      const result = await runScan(options.repoRoot, { dbPath });
      return { status: 'completed', counts: result.counts };
    } catch (err) {
      return fail(reply, 'SCAN_FAILED', err instanceof Error ? err.message : String(err), 500);
    }
  });

  app.get('/api/analyzers', async () => {
    const latest = db
      .select()
      .from(schema.scans)
      .orderBy(desc(schema.scans.startedAt))
      .limit(1)
      .all()[0];
    if (!latest) return [] as AnalyzerStatusDto[];
    const runs = db
      .select()
      .from(schema.analyzerRuns)
      .where(eq(schema.analyzerRuns.scanId, latest.id))
      .all();
    return runs.map((r): AnalyzerStatusDto => ({
      analyzerId: r.analyzerId,
      version: r.version,
      status: r.status,
      diagnostics: (r.diagnostics ?? []) as AnalyzerStatusDto['diagnostics'],
    }));
  });

  app.addHook('onClose', async () => {
    sqlite.close();
  });

  return app;
}
