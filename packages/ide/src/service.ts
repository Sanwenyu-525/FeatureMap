/**
 * FeatureMap IDE service handlers (ADR-0008 §2–3).
 *
 * The service is the same analysis path as CLI / API / MCP — it only
 * exposes a JSON-RPC surface for editor extensions. It is adapter-free
 * of VS Code; the extension is a thin client that spawns `featuremap
 * ide`. Handlers are pure consumers of the Feature Knowledge Graph
 * (AGENTS.md §3.1): no analysis logic lives here beyond querying.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { eq, desc } from 'drizzle-orm';
import { stringify as stringifyYaml } from 'yaml';
import { CONFIG_FILE_NAME, RUNTIME_DIR_NAME, defaultConfig } from '@featuremap/core';
import { defaultDatabasePath, openDatabase, schema, type FeatureMapDatabase } from '@featuremap/db';
import { runScan } from '@featuremap/pipeline';
import { DomainErrorCode, RpcError, RpcErrorCode } from './rpc.js';

export interface IdeServiceOptions {
  repoRoot: string;
  /** Override the SQLite path (tests use a temp db so fixtures stay pristine). */
  dbPath?: string;
}

export interface ProjectStatus {
  initialized: boolean;
  scanned: boolean;
  root: string;
  name?: string;
  baseBranch?: string;
  lastScanAt?: string;
  technologies: Array<{ id: string; confidence: number }>;
  featureCount: number;
}

export interface FeatureSummary {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
  status: string;
  health?: Record<string, string>;
}

export interface FeatureDetail extends FeatureSummary {
  assets: Array<{ id: string; type: string; path?: string; name?: string; confidence: number }>;
  documents: Array<{ path: string; title?: string }>;
  candidates: Array<{
    id: string;
    targetType: string;
    targetId: string;
    relation: string;
    status: string;
    score: number;
    distance: number;
    fanIn: number;
  }>;
}

export type IdeHandler = (params: unknown) => unknown | Promise<unknown>;

export interface IdeService {
  handlers: Record<string, IdeHandler>;
  /** Close the cached SQLite connection (tests on Windows must release it). */
  close(): void;
}

/** Construct the FeatureMap IDE service for a repository. */
export function createIdeService(options: IdeServiceOptions): IdeService {
  const { repoRoot } = options;
  const dbPath = options.dbPath ?? defaultDatabasePath(repoRoot);
  let db: FeatureMapDatabase | undefined;
  let sqlite: ReturnType<typeof openDatabase>['sqlite'] | undefined;

  /** Lazily open the local store; never created just by `project.status`. */
  const getDb = (): FeatureMapDatabase => {
    if (!db) {
      const opened = openDatabase(dbPath);
      db = opened.db;
      sqlite = opened.sqlite;
    }
    return db;
  };

  /** Drop the cached connection so the next query sees scan writes. */
  const closeDb = (): void => {
    if (sqlite) {
      sqlite.close();
      sqlite = undefined;
      db = undefined;
    }
  };

  const requireInitialized = (): void => {
    if (!existsSync(join(repoRoot, CONFIG_FILE_NAME))) {
      throw new RpcError(DomainErrorCode, 'PROJECT_NOT_INITIALIZED: run "featuremap init" (or the Initialize & Scan command) first.');
    }
  };

  const featureSummary = (f: (typeof schema.features.$inferSelect)): FeatureSummary => ({
    id: f.id,
    name: f.name,
    description: f.description ?? undefined,
    pattern: f.pattern,
    confidence: f.confidence,
    status: f.status,
    health: (f.health ?? undefined) as FeatureSummary['health'],
  });

  return {
    handlers: {
    /** project.status — initialized/scanned state without creating anything. */
    'project.status': (): ProjectStatus => {
      const initialized = existsSync(join(repoRoot, CONFIG_FILE_NAME));
      const status: ProjectStatus = {
        initialized,
        scanned: false,
        root: repoRoot,
        technologies: [],
        featureCount: 0,
      };
      if (!initialized) return status;
      const d = getDb();
      const project = d.select().from(schema.projects).limit(1).all()[0];
      const lastScan = d
        .select()
        .from(schema.scans)
        .where(eq(schema.scans.status, 'completed'))
        .orderBy(desc(schema.scans.startedAt))
        .limit(1)
        .all()[0];
      const stats = (lastScan?.stats ?? {}) as { technologies?: Array<{ id: string; confidence: number }> };
      status.name = project?.name;
      status.baseBranch = project?.baseBranch;
      status.scanned = lastScan !== undefined;
      status.lastScanAt = lastScan?.finishedAt ?? undefined;
      status.technologies = stats.technologies ?? [];
      status.featureCount = d.select().from(schema.features).all().length;
      return status;
    },

    /** features.list — product features for the Explorer. */
    'features.list': (): FeatureSummary[] => {
      requireInitialized();
      return getDb()
        .select()
        .from(schema.features)
        .all()
        .map(featureSummary);
    },

    /** features.get — detail used by the Feature → Code navigation. */
    'features.get': (params): FeatureDetail => {
      requireInitialized();
      const input = (params ?? {}) as { featureId?: string };
      if (typeof input.featureId !== 'string' || input.featureId === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'featureId is required.');
      }
      const d = getDb();
      const feature = d.select().from(schema.features).where(eq(schema.features.id, input.featureId)).all()[0];
      if (!feature) {
        throw new RpcError(DomainErrorCode, `FEATURE_NOT_FOUND: ${input.featureId}`);
      }
      const featureAssets = d
        .select()
        .from(schema.featureAssets)
        .where(eq(schema.featureAssets.featureId, feature.id))
        .all();
      const assets: FeatureDetail['assets'] = [];
      for (const fa of featureAssets) {
        const asset = d.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
        if (!asset) continue;
        assets.push({
          id: asset.id,
          type: asset.type,
          path: asset.path ?? undefined,
          name: asset.name ?? undefined,
          confidence: fa.confidence,
        });
      }
      const documents = d
        .select()
        .from(schema.featureDocuments)
        .where(eq(schema.featureDocuments.featureId, feature.id))
        .all()
        .map((fd) => {
          const doc = d.select().from(schema.documents).where(eq(schema.documents.id, fd.documentId)).all()[0];
          return doc ? { path: doc.path, title: doc.title ?? undefined } : undefined;
        })
        .filter((x): x is { path: string; title: string | undefined } => x !== undefined);
      const candidates = d
        .select()
        .from(schema.featureCandidates)
        .where(eq(schema.featureCandidates.featureId, feature.id))
        .all()
        .map((c) => ({
          id: c.id,
          targetType: c.targetType,
          targetId: c.targetId,
          relation: c.relation,
          status: c.status,
          score: c.score,
          distance: c.distance,
          fanIn: c.fanIn,
        }));
      return { ...featureSummary(feature), assets, documents, candidates };
    },

    /** init.run — create featuremap.yaml + .featuremap (idempotent). */
    'init.run': (): { created: boolean; configPath: string } => {
      const configPath = join(repoRoot, CONFIG_FILE_NAME);
      if (existsSync(configPath)) return { created: false, configPath };
      const config = defaultConfig(basename(resolve(repoRoot)));
      writeFileSync(configPath, stringifyYaml(config), 'utf8');
      mkdirSync(join(repoRoot, RUNTIME_DIR_NAME), { recursive: true });
      return { created: true, configPath };
    },

    /** scan.run — incremental (or full) scan; closes the DB so reads refresh. */
    'scan.run': async (params): Promise<{ status: string; counts: Record<string, number> }> => {
      requireInitialized();
      const input = (params ?? {}) as { mode?: string };
      if (input.mode !== undefined && input.mode !== 'incremental' && input.mode !== 'full') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'mode must be "incremental" or "full".');
      }
      const result = await runScan(repoRoot, { full: input.mode === 'full', dbPath });
      closeDb();
      return { status: 'completed', counts: result.counts };
    },
    },
    close: closeDb,
  };
}
