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
import { and, eq, desc, inArray } from 'drizzle-orm';
import { stringify as stringifyYaml } from 'yaml';
import { CONFIG_FILE_NAME, RUNTIME_DIR_NAME, defaultConfig } from '@featuremap/core';
import { defaultDatabasePath, openDatabase, schema, type FeatureMapDatabase } from '@featuremap/db';
import {
  runScan,
  SymbolFeatureIndex,
  getCodeIntelligence,
  getDocumentIntelligence,
  explainFeatureRelation,
  createCurrentImpactStore,
  refreshCurrentImpact,
  getCurrentImpact,
  type CodeIntelligenceResult,
  type CurrentImpactSnapshot,
  type DocumentSymbolFeature,
  type ExplainFeatureRelationResult,
  type RelatedFeaturesOptions,
  type RelatedFeaturesResult,
  type ResolvedSymbol,
  type SymbolRef,
} from '@featuremap/pipeline';
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

export interface FeatureAsset {
  id: string;
  type: string;
  path?: string;
  name?: string;
  confidence: number;
  /** Symbol assets resolve to a source location (Feature → Symbol → source). */
  location?: { startLine: number; endLine: number };
}

export interface FeatureDetail extends FeatureSummary {
  assets: FeatureAsset[];
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

  // SymbolFeatureIndex: in-memory read model built once per repository
  // generation (plan §5). Built lazily; invalidated on scan.run so the
  // next query rebuilds from the fresh store.
  let index: SymbolFeatureIndex | undefined;
  const getIndex = (): SymbolFeatureIndex => {
    requireInitialized();
    if (!index) {
      index = SymbolFeatureIndex.build(repoRoot, dbPath);
    }
    return index;
  };
  const invalidateIndex = (): void => {
    index = undefined;
  };

  // Live Change Impact store (v0.6.3): repo-scoped cached snapshot.
  const impactStore = createCurrentImpactStore();

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

    /** features.list — product features for the Explorer; optional query filter. */
    'features.list': (params): FeatureSummary[] => {
      requireInitialized();
      const input = (params ?? {}) as { query?: string };
      const d = getDb();
      let rows = d.select().from(schema.features).all();
      if (typeof input.query === 'string' && input.query.trim() !== '') {
        const q = input.query.trim().toLowerCase();
        rows = rows.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            (f.description ?? '').toLowerCase().includes(q) ||
            f.pattern.toLowerCase().includes(q),
        );
      }
      return rows.map(featureSummary);
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
      // File map for symbol assets → source location (Feature → Symbol → source).
      const filesByPath = new Map(
        d.select().from(schema.files).all().map((file) => [file.path, file] as const),
      );
      const assets: FeatureDetail['assets'] = [];
      for (const fa of featureAssets) {
        const asset = d.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
        if (!asset) continue;
        let location: FeatureAsset['location'];
        if (asset.type === 'symbol' && asset.path && asset.name) {
          const file = filesByPath.get(asset.path);
          if (file) {
            const symbol = d
              .select()
              .from(schema.symbols)
              .where(and(eq(schema.symbols.fileId, file.id), eq(schema.symbols.name, asset.name)))
              .all()[0];
            if (symbol?.startLine != null) {
              location = { startLine: symbol.startLine, endLine: symbol.endLine ?? symbol.startLine };
            }
          }
        }
        assets.push({
          id: asset.id,
          type: asset.type,
          path: asset.path ?? undefined,
          name: asset.name ?? undefined,
          confidence: fa.confidence,
          location,
        });
      }
      // Confirmed symbol relations (declared/accepted) also surface as
      // navigable "Core Code" entries (Feature → Symbol → source). Only
      // confirmed relations — suggestions stay out of the Explorer until
      // reviewed (low noise, ADR-0008 §6).
      const confirmedSymbols = d
        .select()
        .from(schema.featureCandidates)
        .where(
          and(
            eq(schema.featureCandidates.featureId, feature.id),
            eq(schema.featureCandidates.targetType, 'symbol'),
            inArray(schema.featureCandidates.status, ['declared', 'accepted']),
          ),
        )
        .all();
      for (const cand of confirmedSymbols) {
        const sep = cand.targetId.lastIndexOf(':');
        const path = sep > 0 ? cand.targetId.slice(0, sep) : undefined;
        const name = sep > 0 ? cand.targetId.slice(sep + 1) : cand.targetId;
        if (!path) continue;
        const file = filesByPath.get(path);
        if (!file) continue;
        const symbol = d
          .select()
          .from(schema.symbols)
          .where(and(eq(schema.symbols.fileId, file.id), eq(schema.symbols.name, name)))
          .all()[0];
        assets.push({
          id: cand.id,
          type: 'symbol',
          path,
          name,
          confidence: cand.score,
          location:
            symbol?.startLine != null
              ? { startLine: symbol.startLine, endLine: symbol.endLine ?? symbol.startLine }
              : undefined,
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

    /** scan.run — incremental (or full) scan; invalidates index + DB connection. */
    'scan.run': async (params): Promise<{ status: string; counts: Record<string, number> }> => {
      requireInitialized();
      const input = (params ?? {}) as { mode?: string };
      if (input.mode !== undefined && input.mode !== 'incremental' && input.mode !== 'full') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'mode must be "incremental" or "full".');
      }
      const result = await runScan(repoRoot, { full: input.mode === 'full', dbPath });
      closeDb();
      invalidateIndex();
      return { status: 'completed', counts: result.counts };
    },

    /** symbols.resolve — editor hint → stored symbol (plan §4.1). */
    'symbols.resolve': (params): ResolvedSymbol | null => {
      const input = (params ?? {}) as { symbol?: SymbolRef };
      if (typeof input.symbol?.filePath !== 'string' || input.symbol.filePath === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'symbol.filePath is required.');
      }
      return getIndex().resolveSymbol(input.symbol);
    },

    /** code.relatedFeatures — Symbol → Related Features (plan §4.2). */
    'code.relatedFeatures': (params): RelatedFeaturesResult | null => {
      const input = (params ?? {}) as { symbol?: SymbolRef; options?: RelatedFeaturesOptions };
      if (typeof input.symbol?.filePath !== 'string' || input.symbol.filePath === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'symbol.filePath is required.');
      }
      return getIndex().relatedFeatures(input.symbol, input.options);
    },

    /** code.intelligence — compact Hover payload (plan §4.3). */
    'code.intelligence': (params): CodeIntelligenceResult | null => {
      const input = (params ?? {}) as { symbol?: SymbolRef };
      if (typeof input.symbol?.filePath !== 'string' || input.symbol.filePath === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'symbol.filePath is required.');
      }
      return getCodeIntelligence(repoRoot, input.symbol, { index: getIndex(), dbPath });
    },

    /** code.documentIntelligence — one batch call per document for CodeLens (plan §8.4). */
    'code.documentIntelligence': (params): DocumentSymbolFeature[] => {
      const input = (params ?? {}) as { filePath?: string };
      if (typeof input.filePath !== 'string' || input.filePath === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'filePath is required.');
      }
      return getDocumentIntelligence(input.filePath, { index: getIndex() });
    },

    /** code.explainRelation — evidence chain behind one relation (plan §4.4). */
    'code.explainRelation': (params): ExplainFeatureRelationResult => {
      const input = (params ?? {}) as { featureId?: string; target?: { id?: string } | string };
      if (typeof input.featureId !== 'string' || input.featureId === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'featureId is required.');
      }
      const targetId = typeof input.target === 'string' ? input.target : input.target?.id;
      if (typeof targetId !== 'string' || targetId === '') {
        throw new RpcError(RpcErrorCode.InvalidParams, 'target.id is required.');
      }
      return explainFeatureRelation(repoRoot, input.featureId, targetId, dbPath);
    },

    /**
     * impact.refresh — save-triggered orchestration (v0.6.3 plan §7.1):
     * incremental scan → analyzeImpact(WORKING_TREE) → cached snapshot.
     * The code-intelligence index is invalidated so Hover/CodeLens see
     * the fresh graph (plan §26).
     */
    'impact.refresh': async (params): Promise<unknown> => {
      requireInitialized();
      const input = (params ?? {}) as { savedFiles?: string[]; trigger?: 'save' | 'manual' };
      const savedFiles = Array.isArray(input.savedFiles)
        ? input.savedFiles.filter((s): s is string => typeof s === 'string')
        : [];
      const trigger = input.trigger === 'manual' ? 'manual' : 'save';
      try {
        const result = await refreshCurrentImpact(repoRoot, { savedFiles, trigger, dbPath }, impactStore);
        invalidateIndex();
        return result;
      } catch (err) {
        throw new RpcError(
          DomainErrorCode,
          `IMPACT_REFRESH_FAILED: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    /** impact.current — cheap read of the last snapshot (plan §7.2), never triggers analysis. */
    'impact.current': (): { available: boolean; snapshot?: CurrentImpactSnapshot } =>
      getCurrentImpact(repoRoot, impactStore),
    },
    close: closeDb,
  };
}
