/**
 * Local Fastify API — docs/API_SPEC.md.
 *
 * Local-only by default; binds to loopback unless explicitly
 * configured. Returns DTOs with evidence and confidence preserved.
 */
import { eq, desc, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { buildFeatureContextDocument, FeatureContextError } from '@featuremap/context';
import { runScan, analyzeImpact, setVerdict, ReviewError, featureTimeline } from '@featuremap/pipeline';
import type {
  AnalyzerStatusDto,
  CandidateDto,
  ChangesResponse,
  FeatureDetailDto,
  FeatureListItemDto,
  OverviewResponse,
  ProjectResponse,
  VerdictRequest,
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

  // Serve the built Web UI when present (docs/MVP_SPEC.md §6: featuremap
  // dev starts the local API *and* Web UI). The dist folder lives in the
  // FeatureMap installation, not in the scanned repository.
  const webDist = join(fileURLToPath(new URL('../../../apps/web/dist', import.meta.url)));
  if (existsSync(join(webDist, 'index.html'))) {
    app.register(fastifyStatic, { root: webDist, prefix: '/' });
    // SPA fallback: client-side routes (e.g. /features) resolve to the app.
    // Unknown /api paths keep the JSON error envelope (docs/API_SPEC.md §4).
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' } });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  }

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
    const candidates: CandidateDto[] = (
      db
        .select()
        .from(schema.featureCandidates)
        .where(eq(schema.featureCandidates.featureId, id))
        .all() as CandidateDto[]
    ).sort((a, b) => b.score - a.score);
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
      candidates,
      evidence,
    };
    return body;
  });

  /** Record a human verdict on a candidate (Milestone 8, ADR-0003 §4). */
  app.post('/api/features/:id/candidates/verdict', async (req, reply) => {
    const id = decodeURIComponent((req.params as { id: string }).id);
    const body = (req.body ?? {}) as Partial<VerdictRequest>;
    if (body.verdict !== 'accepted' && body.verdict !== 'rejected') {
      return fail(reply, 'INVALID_CONFIG', 'verdict must be "accepted" or "rejected".', 400);
    }
    if (typeof body.targetId !== 'string' || body.targetId === '') {
      return fail(reply, 'INVALID_CONFIG', 'targetId is required.', 400);
    }
    try {
      const row = setVerdict(options.repoRoot, id, body.targetId, body.verdict, dbPath);
      return { status: row.status, targetId: row.targetId, featureId: row.featureId };
    } catch (err) {
      if (err instanceof ReviewError) {
        const statusCode = err.code === 'FEATURE_NOT_FOUND' || err.code === 'CANDIDATE_NOT_FOUND' ? 404 : 400;
        return fail(reply, err.code, err.message, statusCode);
      }
      throw err;
    }
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

  /** Feature change timeline (Milestone 14 / ADR-0004 §6), derived at query time. */
  app.get('/api/features/:id/changes', async (req, reply) => {
    const id = decodeURIComponent((req.params as { id: string }).id);
    try {
      return featureTimeline(options.repoRoot, id, dbPath);
    } catch {
      return fail(reply, 'FEATURE_NOT_FOUND', `Feature "${id}" does not exist.`, 404);
    }
  });

  app.get('/api/changes', async (req, reply) => {
    const project = getProject(db);
    if (!project) {
      return fail(reply, 'PROJECT_NOT_INITIALIZED', 'Run "featuremap init" and "featuremap scan" first.', 404);
    }
    // Impact traversal over evidence-backed relations only
    // (AGENTS.md §9); low-confidence hits stay unsurfaced.
    // Optional `range` query turns this into a commit-range analysis
    // (ADR-0004 §1): ?range=main..HEAD
    const query = req.query as { range?: string };
    const impact = await analyzeImpact(options.repoRoot, { range: query.range, dbPath });
    const body: ChangesResponse = {
      currentBranch: impact.currentBranch,
      baseBranch: impact.baseBranch ?? project.baseBranch,
      changedFiles: impact.changedFiles,
      affectedFeatures: impact.affectedFeatures.map((f) => ({
        featureId: f.featureId,
        featureName: f.featureName,
        confidence: f.confidence,
        severity: f.severity,
        reasons: f.reasons,
      })),
      sharedInfrastructure: impact.sharedInfrastructure,
      suppressedUncertainty: impact.suppressedUncertainty,
      recommendedTests: impact.recommendedTests,
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

  /**
   * POST /api/context — the canonical read-only FeatureContext document
   * (v0.7.0, Milestone 25 §Stage 1). One endpoint, task in the POST body
   * only; the response is the exact `FeatureContextDocument` the CLI /
   * MCP / IDE render (no HTTP-only DTO). `Cache-Control: no-store`
   * because the projection depends on live graph + working-tree state.
   */
  app.post('/api/context', async (req, reply) => {
    const body = (req.body ?? {}) as { featureId?: unknown; task?: unknown };
    if (typeof body.featureId !== 'string' || body.featureId === '') {
      return fail(reply, 'INVALID_CONFIG', 'featureId is required.', 400);
    }
    if (body.task !== undefined && typeof body.task !== 'string') {
      return fail(reply, 'INVALID_CONFIG', 'task must be a string.', 400);
    }
    try {
      const document = buildFeatureContextDocument(options.repoRoot, body.featureId, {
        task: body.task,
        dbPath,
      });
      reply.header('cache-control', 'no-store');
      return reply.send(document);
    } catch (err) {
      if (err instanceof FeatureContextError && err.code === 'FEATURE_NOT_FOUND') {
        return fail(reply, 'FEATURE_NOT_FOUND', `Feature "${body.featureId}" does not exist.`, 404);
      }
      return fail(reply, 'CONTEXT_BUILD_FAILED', err instanceof Error ? err.message : String(err), 500);
    }
  });

  app.addHook('onClose', async () => {
    sqlite.close();
  });

  return app;
}
