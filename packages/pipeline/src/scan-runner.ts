/**
 * Scan orchestrator — docs/ARCHITECTURE.md §4 scan lifecycle.
 *
 * Source → Scanner → Analyzer → Evidence → Feature Engine → Store:
 * the orchestrator persists normalized evidence and discovered
 * features, then returns a stable JSON structure. Shared by the CLI
 * (`scan`) and the local API (`POST /scan`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { loadConfig, DEFAULT_FEATURE_HEALTH } from '@featuremap/core';
import { scanRepository } from '@featuremap/scanner';
import {
  runAnalyzers,
  builtInAnalyzers,
  assetId,
  evidenceId,
  collectGitInfo,
  WORKING_TREE_SHA,
  BRANCH_DIFF_SHA,
  type PlatformOutput,
  type EvidenceInput,
} from '@featuremap/analyzer';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { discoverFeatures, isTestPath, slugify, type DiscoveredFeature } from './feature-discovery.js';
import { expandCandidates, resolveAnchors } from './candidates.js';

export interface ScanJsonOutput {
  project: {
    name: string;
    root: string;
    currentBranch?: string;
    baseBranch: string;
  };
  technologies: Array<{ id: string; confidence: number; source: string }>;
  counts: {
    files: number;
    symbols: number;
    endpoints: number;
    dataEntities: number;
    documents: number;
    instructions: number;
    features: number;
    candidates: number;
    evidence: number;
    commits: number;
  };
  files: Array<{ path: string; hash: string; language?: string; size: number }>;
  symbols: Array<{ path: string; name: string; kind: string; exported: boolean }>;
  endpoints: Array<{ path?: string; name: string }>;
  documents: Array<{ path: string; type: string; title?: string }>;
  features: Array<{
    id: string;
    name: string;
    pattern: string;
    confidence: number;
    health: Record<string, string>;
  }>;
  /** Scored feature↔code candidates (Milestone 7, ADR-0003 §3–5). */
  candidates: CandidateDto[];
  commits: Array<{ sha: string; author: string; committedAt: string; message: string }>;
  evidence: Array<EvidenceInput & { id: string; analyzerId: string; origin: string }>;
  runs: Array<{
    analyzerId: string;
    version: string;
    status: string;
    assetCount: number;
    evidenceCount: number;
  }>;
}

export interface ScanOptions {
  json?: boolean;
  full?: boolean;
  /** Override the SQLite store location (used by tests). */
  dbPath?: string;
}

export interface CandidateDto {
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  relation: 'owns' | 'DEPENDS_ON';
  status: 'declared' | 'suggested' | 'accepted' | 'rejected' | 'superseded';
  score: number;
  distance: number;
  fanIn: number;
}

function projectIdFor(root: string): string {
  return `p_${assetId({ type: 'file', path: root }).slice(2)}`;
}

/** Extract symbol rows from analyzer symbol assets. */
function collectSymbols(output: PlatformOutput): Array<{
  id: string;
  path: string;
  name: string;
  kind: string;
  exported: boolean;
}> {
  const symbols: Array<{
    id: string;
    path: string;
    name: string;
    kind: string;
    exported: boolean;
  }> = [];
  for (const asset of output.assets) {
    if (asset.type !== 'symbol' || asset.path === undefined || asset.name === undefined) continue;
    const meta = (asset.metadata ?? {}) as { kind?: string; exported?: boolean };
    symbols.push({
      id: `symbol:${asset.path}:${asset.name}`,
      path: asset.path,
      name: asset.name,
      kind: meta.kind ?? 'symbol',
      exported: meta.exported ?? false,
    });
  }
  return symbols;
}

/**
 * Execute a full scan: scan, analyze, discover features, collect git
 * facts, persist everything and return the JSON structure.
 */
export async function runScan(repoRoot: string, options: ScanOptions = {}): Promise<ScanJsonOutput> {
  void options.full; // accepted; Milestone 1 always performs a full rebuild.
  const loaded = loadConfig(repoRoot);
  if (!loaded.config) {
    const first = loaded.issues.find((i) => i.level === 'error') ?? loaded.issues[0];
    throw new Error(first ? `${first.code}: ${first.message}` : 'Invalid configuration');
  }
  const config = loaded.config;

  // Steps 1-6 (docs/ARCHITECTURE.md §4): files, hashes, documents, technologies
  const scan = scanRepository(repoRoot, {
    ignore: config.scan.ignore,
    baseBranch: config.scan.baseBranch,
  });

  // Step 7: deterministic analyzers (failures isolated per analyzer)
  const readFile = (rel: string): string | undefined => {
    try {
      return readFileSync(join(scan.repoRoot, rel), 'utf8');
    } catch {
      return undefined;
    }
  };
  const enabledSet = new Set<string>(config.analyzers.enabled);
  const plugins = builtInAnalyzers.filter((p) => enabledSet.has(p.id));
  const output = await runAnalyzers(
    plugins,
    {
      repoRoot: scan.repoRoot,
      files: scan.files,
      readFile,
      config: { analyzers: config.analyzers.enabled, scan: config.scan },
    },
    scan.files,
  );

  // Git facts (degrades gracefully without git)
  const gitInfo = await collectGitInfo(scan.repoRoot, config.scan.baseBranch);

  // ---- Derived artifacts -------------------------------------------------
  const symbols = collectSymbols(output);

  const mdTitles = new Map<string, string>();
  for (const asset of output.assets) {
    if (asset.type === 'file' && asset.language === 'Markdown') {
      const meta = (asset.metadata ?? {}) as { title?: string };
      if (meta.title) mdTitles.set(asset.path ?? '', meta.title);
    }
  }

  // Feature discovery (Milestone 2): deterministic clustering.
  const discovered = discoverFeatures(output.assets, output.evidence);

  // ---- Anchor-driven candidate expansion (Milestone 7, ADR-0003) ----------
  // Endpoint/CLI anchors from discovered features plus declared anchors
  // from the configuration. Declared anchors for features without an
  // HTTP surface (CLI tools, core libraries) create visible features.
  const declaredAnchors = config.features.anchors.map((a) => ({
    featureId: `feature:${slugify(a.feature)}`,
    type: a.type,
    target: a.target,
  }));
  const discoveredIds = new Set(discovered.map((f) => f.id));
  for (const anchor of declaredAnchors) {
    if (discoveredIds.has(anchor.featureId)) continue;
    const name = anchor.featureId.slice('feature:'.length);
    discovered.push({
      id: anchor.featureId,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      pattern: 'Generic',
      confidence: 1.0,
      health: { ...DEFAULT_FEATURE_HEALTH },
      anchors: [],
      closureFiles: [],
      documents: [],
      tests: [],
    });
  }
  const endpointAnchors = discovered.flatMap((f) =>
    f.anchors
      .filter((a) => (a.type === 'endpoint' || a.type === 'cli_command') && a.name !== undefined)
      .map((a) => ({ featureId: f.id, name: a.name! })),
  );
  const anchorNodes = resolveAnchors(endpointAnchors, declaredAnchors, output.evidence);
  const candidates = expandCandidates(anchorNodes, output.evidence);

  const fileAssetId = (path: string): string =>
    assetId({ type: isTestPath(path) ? 'test' : 'file', path });

  const allChanges = [
    ...gitInfo.commitChanges,
    ...gitInfo.workingChanges,
    ...gitInfo.branchChanges,
  ];
  const gitEvidence: Array<EvidenceInput & { analyzerId: string }> = allChanges.map((change) => ({
    sourceType: 'file' as const,
    sourceId: change.path,
    relationType: 'MODIFIED_BY' as const,
    targetType: 'commit' as const,
    targetId: `commit:${change.commitSha}`,
    confidence: 1.0,
    analyzerId: 'git',
    metadata: { changeType: change.changeType },
  }));

  // Every feature mapping emits BELONGS_TO_FEATURE evidence so the UI
  // can always answer "Why?" (AGENTS.md §1, docs/DATA_MODEL.md §3).
  const featureEvidence: Array<EvidenceInput & { analyzerId: string }> = [];
  for (const feature of discovered) {
    for (const anchor of feature.anchors) {
      const sourceId =
        anchor.type === 'endpoint' ? `endpoint:${anchor.name}` : anchor.path ?? anchor.id;
      featureEvidence.push({
        sourceType: anchor.type,
        sourceId,
        relationType: 'BELONGS_TO_FEATURE',
        targetType: 'feature',
        targetId: feature.id,
        confidence: 1.0,
        analyzerId: 'feature-engine',
        metadata: { role: 'anchor' },
      });
    }
    for (const file of feature.closureFiles) {
      featureEvidence.push({
        sourceType: isTestPath(file) ? 'test' : 'file',
        sourceId: file,
        relationType: 'BELONGS_TO_FEATURE',
        targetType: 'feature',
        targetId: feature.id,
        confidence: 0.9,
        analyzerId: 'feature-engine',
        metadata: { role: 'closure' },
      });
    }
  }

  const allEvidence: Array<
    EvidenceInput & { id: string; analyzerId: string; origin: 'deterministic' }
  > = [
    ...output.evidence.map((e) => ({
      id: e.id,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      relationType: e.relationType,
      targetType: e.targetType,
      targetId: e.targetId,
      confidence: e.confidence,
      analyzerId: e.analyzerId,
      origin: 'deterministic' as const,
      metadata: e.metadata,
    })),
    ...gitEvidence.map((e) => ({
      ...e,
      id: evidenceId(e),
      origin: 'deterministic' as const,
    })),
    ...featureEvidence.map((e) => ({
      ...e,
      id: evidenceId(e),
      origin: 'deterministic' as const,
    })),
  ];

  // ---- Persist (step 9) ----------------------------------------------------
  const dbPath = options.dbPath ?? defaultDatabasePath(scan.repoRoot);
  const { db, sqlite } = openDatabase(dbPath);
  let candidateDtos: CandidateDto[] = [];
  try {
    const projectId = projectIdFor(scan.repoRoot);
    db.insert(schema.projects)
      .values({
        id: projectId,
        name: config.project.name,
        root: scan.repoRoot,
        baseBranch: config.scan.baseBranch,
      })
      .onConflictDoUpdate({
        target: schema.projects.id,
        set: { name: config.project.name, baseBranch: config.scan.baseBranch },
      })
      .run();

    const scanId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.insert(schema.scans)
      .values({
        id: scanId,
        projectId,
        mode: 'full',
        status: 'running',
        stats: { currentBranch: gitInfo.currentBranch, technologies: scan.technologies },
      })
      .run();

    // Content tables are rebuilt each scan (single-repo local tool).
    // features last: its join tables cascade.
    // Candidate verdicts survive rescans (ADR-0003 §4): read them
    // before the features delete cascades wipe feature_candidates.
    const previousCandidates = db.select().from(schema.featureCandidates).all();
    db.delete(schema.features).run();
    db.delete(schema.evidence).run();
    db.delete(schema.commitFiles).run();
    db.delete(schema.commits).run();
    db.delete(schema.symbols).run();
    db.delete(schema.assets).run();
    db.delete(schema.documents).run();
    db.delete(schema.analyzerRuns).run();
    db.delete(schema.files).run();

    for (const f of scan.files) {
      db.insert(schema.files)
        .values({
          id: assetId({ type: 'file', path: f.path }),
          projectId,
          path: f.path,
          hash: f.hash,
          language: f.language,
          size: f.size,
          lastSeenScanId: scanId,
        })
        .run();
    }

    for (const sym of symbols) {
      db.insert(schema.symbols)
        .values({
          id: sym.id,
          fileId: assetId({ type: 'file', path: sym.path }),
          name: sym.name,
          kind: sym.kind,
        })
        .onConflictDoNothing()
        .run();
    }

    for (const asset of output.assets) {
      db.insert(schema.assets)
        .values({
          id: asset.id,
          type: asset.type,
          path: asset.path,
          name: asset.name,
          language: asset.language,
          metadata: asset.metadata,
        })
        .onConflictDoNothing()
        .run();
    }

    for (const doc of scan.documents) {
      db.insert(schema.documents)
        .values({ id: doc.path, path: doc.path, type: doc.type, title: mdTitles.get(doc.path) })
        .run();
    }

    for (const feature of discovered) {
      insertFeature(db, feature, fileAssetId);
    }

    // ---- Candidate persistence (Milestones 7–8, ADR-0003 §4) ---------------
    // Rescan re-derives suggestions but never silently overwrites
    // accepted/rejected verdicts. Verdicts persist while their evidence
    // fingerprint is stable; a changed chain means the relation is
    // essentially new, so the verdict is surfaced as `superseded` for
    // re-review instead of suppressing a new relation
    // (docs/releases/v0.2-acceptance.md §4).
    const previousById = new Map(previousCandidates.map((r) => [r.id, r]));
    const currentFeatureIds = new Set(discovered.map((f) => f.id));
    const derivedIds = new Set<string>();
    for (const candidate of candidates) {
      const id = candidateIdOf(candidate);
      derivedIds.add(id);
      const previous = previousById.get(id);
      let status: CandidateDto['status'] = candidate.status;
      if (previous && (previous.status === 'accepted' || previous.status === 'rejected')) {
        status =
          previous.fingerprint !== null && previous.fingerprint !== candidate.fingerprint
            ? 'superseded'
            : previous.status;
      } else if (previous?.status === 'superseded') {
        // Re-derived after drift: offer afresh for review.
        status = 'suggested';
      }
      db.insert(schema.featureCandidates)
        .values({
          id,
          featureId: candidate.featureId,
          targetType: candidate.targetType,
          targetId: candidate.targetId,
          relation: candidate.relation,
          status,
          score: candidate.score,
          distance: candidate.distance,
          fanIn: candidate.fanIn,
          evidenceChain: candidate.evidenceChain,
          fingerprint: candidate.fingerprint,
        })
        .run();
    }
    for (const previous of previousCandidates) {
      if (previous.status !== 'accepted' && previous.status !== 'rejected') continue;
      if (derivedIds.has(previous.id)) continue;
      if (!currentFeatureIds.has(previous.featureId)) continue;
      // Evidence chain vanished: the verdict no longer maps to a live
      // relation — keep the row but mark it for re-review.
      db.insert(schema.featureCandidates)
        .values({ ...previous, status: 'superseded' })
        .run();
    }

    for (const commit of gitInfo.commits) {
      db.insert(schema.commits)
        .values({
          sha: commit.sha,
          projectId,
          author: commit.author,
          email: commit.email,
          message: commit.message,
          committedAt: commit.committedAt,
        })
        .onConflictDoNothing()
        .run();
    }
    if (gitInfo.workingChanges.length > 0) {
      db.insert(schema.commits)
        .values({ sha: WORKING_TREE_SHA, projectId, message: 'Working tree changes' })
        .onConflictDoNothing()
        .run();
    }
    if (gitInfo.branchChanges.length > 0) {
      db.insert(schema.commits)
        .values({
          sha: BRANCH_DIFF_SHA,
          projectId,
          message: `Branch changes vs ${config.scan.baseBranch}`,
        })
        .onConflictDoNothing()
        .run();
    }
    for (const change of allChanges) {
      db.insert(schema.commitFiles)
        .values({ commitSha: change.commitSha, path: change.path, changeType: change.changeType })
        .onConflictDoNothing()
        .run();
    }

    for (const ev of allEvidence) {
      db.insert(schema.evidence)
        .values({
          id: ev.id,
          sourceType: ev.sourceType,
          sourceId: ev.sourceId,
          relationType: ev.relationType,
          targetType: ev.targetType,
          targetId: ev.targetId,
          confidence: ev.confidence,
          analyzerId: ev.analyzerId,
          origin: ev.origin,
          metadata: ev.metadata,
          scanId,
        })
        .onConflictDoNothing()
        .run();
    }

    for (const run of output.runs) {
      db.insert(schema.analyzerRuns)
        .values({
          id: `${scanId}_${run.analyzerId}`,
          scanId,
          analyzerId: run.analyzerId,
          version: run.version,
          status: run.status === 'degraded' || run.status === 'failed' ? run.status : 'ok',
          diagnostics: run.diagnostics,
        })
        .run();
    }

    db.update(schema.scans)
      .set({ status: 'completed', finishedAt: new Date().toISOString() })
      .where(eq(schema.scans.id, scanId))
      .run();

    candidateDtos = db
      .select()
      .from(schema.featureCandidates)
      .all()
      .map((r) => ({
        featureId: r.featureId,
        targetType: r.targetType,
        targetId: r.targetId,
        relation: r.relation,
        status: r.status,
        score: r.score,
        distance: r.distance,
        fanIn: r.fanIn,
      }));
  } finally {
    sqlite.close();
  }

  // ---- Stable JSON structure ------------------------------------------------
  const endpoints = output.assets
    .filter((a) => a.type === 'endpoint')
    .map((a) => ({ path: a.path, name: a.name ?? '' }));
  const dataEntityCount = output.assets.filter((a) => a.type === 'data_entity').length;

  return {
    project: {
      name: config.project.name,
      root: scan.repoRoot,
      currentBranch: gitInfo.currentBranch,
      baseBranch: config.scan.baseBranch,
    },
    technologies: scan.technologies,
    counts: {
      files: scan.files.length,
      symbols: symbols.length,
      endpoints: endpoints.length,
      dataEntities: dataEntityCount,
      documents: scan.documents.length,
      instructions: 0,
      features: discovered.length,
      candidates: candidateDtos.length,
      evidence: allEvidence.length,
      commits: gitInfo.commits.length,
    },
    files: scan.files.map((f) => ({
      path: f.path,
      hash: f.hash.slice(0, 12),
      language: f.language,
      size: f.size,
    })),
    symbols: symbols.map((s) => ({
      path: s.path,
      name: s.name,
      kind: s.kind,
      exported: s.exported,
    })),
    endpoints,
    documents: scan.documents.map((d) => ({
      path: d.path,
      type: d.type,
      title: mdTitles.get(d.path),
    })),
    features: discovered.map((f) => ({
      id: f.id,
      name: f.name,
      pattern: f.pattern,
      confidence: f.confidence,
      health: { ...f.health },
    })),
    candidates: candidateDtos,
    commits: gitInfo.commits.slice(0, 10).map((c) => ({
      sha: c.sha,
      author: c.author,
      committedAt: c.committedAt,
      message: c.message,
    })),
    evidence: allEvidence,
    runs: output.runs.map((r) => ({
      analyzerId: r.analyzerId,
      version: r.version,
      status: r.status,
      assetCount: r.assetCount,
      evidenceCount: r.evidenceCount,
    })),
  };
}

type Db = ReturnType<typeof openDatabase>['db'];

/** Deterministic candidate row id, stable across rescans. */
function candidateIdOf(candidate: {
  featureId: string;
  targetType: string;
  targetId: string;
}): string {
  return `cand:${candidate.featureId}:${candidate.targetType}:${candidate.targetId}`;
}

function insertFeature(db: Db, feature: DiscoveredFeature, fileAssetId: (path: string) => string): void {
  db.insert(schema.features)
    .values({
      id: feature.id,
      name: feature.name,
      pattern: feature.pattern,
      confidence: feature.confidence,
      status: 'active',
      health: { ...feature.health },
    })
    .run();

  for (const anchor of feature.anchors) {
    db.insert(schema.featureAssets)
      .values({ featureId: feature.id, assetId: anchor.id, confidence: 1.0 })
      .onConflictDoNothing()
      .run();
  }
  for (const file of feature.closureFiles) {
    db.insert(schema.featureAssets)
      .values({ featureId: feature.id, assetId: fileAssetId(file), confidence: 0.9 })
      .onConflictDoNothing()
      .run();
  }

  for (const doc of feature.documents) {
    db.insert(schema.featureDocuments)
      .values({ featureId: feature.id, documentId: doc, confidence: 0.9 })
      .onConflictDoNothing()
      .run();
  }
}
