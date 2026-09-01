/**
 * Scan orchestrator — docs/ARCHITECTURE.md §4 scan lifecycle, Milestone 1
 * scope (docs/DEVELOPMENT_PLAN.md).
 *
 * Source → Scanner → Analyzer → Evidence → Store: the orchestrator
 * persists normalized evidence and returns a stable JSON structure.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { loadConfig } from '@featuremap/core';
import { scanRepository } from '@featuremap/scanner';
import {
  runAnalyzers,
  builtInAnalyzers,
  assetId,
  evidenceId,
  collectGitInfo,
  WORKING_TREE_SHA,
  type PlatformOutput,
  type EvidenceInput,
} from '@featuremap/analyzer';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';

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
    evidence: number;
    commits: number;
  };
  files: Array<{ path: string; hash: string; language?: string; size: number }>;
  symbols: Array<{ path: string; name: string; kind: string; exported: boolean }>;
  endpoints: Array<{ path?: string; name: string }>;
  documents: Array<{ path: string; type: string; title?: string }>;
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
 * Execute a full scan: scan, analyze, collect git facts, persist and
 * return the JSON structure for `featuremap scan --json`.
 */
export async function runScan(repoRoot: string, options: ScanOptions = {}): Promise<ScanJsonOutput> {
  void options; // --full accepted; Milestone 1 always performs a full rebuild.
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

  // Evidence: analyzer output + deterministic git modification facts
  const allChanges = [...gitInfo.commitChanges, ...gitInfo.workingChanges];
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
  const allEvidence: Array<EvidenceInput & { id: string; analyzerId: string; origin: 'deterministic' }> = [
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
  ];

  const symbols = collectSymbols(output);
  const mdTitles = new Map<string, string>();
  for (const asset of output.assets) {
    if (asset.type === 'file' && asset.language === 'Markdown') {
      const meta = (asset.metadata ?? {}) as { title?: string };
      if (meta.title) mdTitles.set(asset.path ?? '', meta.title);
    }
  }

  // Persist evidence (step 9)
  const dbPath = defaultDatabasePath(scan.repoRoot);
  const { db, sqlite } = openDatabase(dbPath);
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
      .values({ id: scanId, projectId, mode: 'full', status: 'running' })
      .run();

    // Milestone 1 rebuilds content tables each scan (single-repo local tool).
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
  } finally {
    sqlite.close();
  }

  // Stable JSON structure (Milestone 1 exit criteria)
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

export function ensureRepoRoot(path?: string): string {
  const root = path ?? process.cwd();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  return root;
}
