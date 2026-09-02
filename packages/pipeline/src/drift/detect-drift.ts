/**
 * detectDrift — pipeline drift entry for IDE diagnostics (v0.6.4 plan §3/§7).
 *
 * Computes drift over the **post-scan indexed state** for the whole
 * working tree (never a commit range) and never triggers a scan itself:
 * callers refresh the graph first (impact.refresh / scan.run / init.run)
 * and then call diagnostics.drift as a cheap read.
 *
 * Locations are a pipeline responsibility (plan §21–§23): new_candidate
 * points at the symbol range; relation_broken resolves a surviving
 * confirmed asset (deterministic first) so Problems never point at a
 * file that no longer exists.
 */
import { eq, inArray } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { analyzeImpact } from '../impact.js';
import { computeDrift, summarizeDrift, type DriftInput } from './compute-drift.js';
import type { DriftIssue, DriftReport } from './drift-types.js';

export interface DetectDriftOptions {
  dbPath?: string;
  /** v0.6.4 supports only the whole working tree. */
  scope?: 'WORKING_TREE';
}

export async function detectDrift(repoRoot: string, options: DetectDriftOptions = {}): Promise<DriftReport> {
  const dbPath = options.dbPath ?? defaultDatabasePath(repoRoot);
  // Whole working tree (impact default = working tree + branch diff).
  const impact = await analyzeImpact(repoRoot, { dbPath });

  const { db, sqlite } = openDatabase(dbPath);
  try {
    const featureNames = new Map(db.select().from(schema.features).all().map((f) => [f.id, f.name]));

    const ownedFilesByFeature = new Map<string, Set<string>>();
    const testPaths = new Set<string>();
    for (const asset of db.select().from(schema.assets).all()) {
      if (asset.type === 'test' && asset.path) testPaths.add(asset.path);
    }
    for (const fa of db.select().from(schema.featureAssets).all()) {
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
      if (!asset?.path) continue;
      const set = ownedFilesByFeature.get(fa.featureId) ?? new Set<string>();
      set.add(asset.path);
      ownedFilesByFeature.set(fa.featureId, set);
    }

    const confirmed = db
      .select()
      .from(schema.featureCandidates)
      .where(inArray(schema.featureCandidates.status, ['accepted', 'declared']))
      .all();

    const input: DriftInput = {
      confirmed: confirmed.map((c) => ({
        featureId: c.featureId,
        targetType: c.targetType,
        targetId: c.targetId,
        status: c.status,
        score: c.score,
        fingerprint: c.fingerprint,
      })),
      changeTypeByPath: new Map(impact.changedFiles.map((c) => [c.path, c.changeType])),
      changedSymbols: impact.changedSymbols,
      ownedFilesByFeature,
      testPaths,
      featureNames,
    };

    const issues = computeDrift(input);
    enrichLocations(db, issues, ownedFilesByFeature);

    return { issues, summary: summarizeDrift(issues) };
  } finally {
    sqlite.close();
  }
}

/** Resolve 1-based locations; a relation_broken with no surviving anchor keeps none. */
function enrichLocations(
  db: ReturnType<typeof openDatabase>['db'],
  issues: DriftIssue[],
  ownedFilesByFeature: Map<string, Set<string>>,
): void {
  // Symbol ranges for new_candidate: path:name → range.
  const symbolRangeByKey = new Map<string, { startLine: number; endLine?: number }>();
  const fileRows = db.select().from(schema.files).all();
  const pathById = new Map(fileRows.map((f) => [f.id, f.path]));
  for (const s of db.select().from(schema.symbols).all()) {
    const path = pathById.get(s.fileId);
    if (!path || s.startLine == null) continue;
    symbolRangeByKey.set(`${path}:${s.name}`, { startLine: s.startLine, endLine: s.endLine ?? undefined });
  }

  // Surviving confirmed assets per feature (deterministic first by path).
  const survivingPathByFeature = new Map<string, string | undefined>();
  for (const [featureId, paths] of ownedFilesByFeature) {
    const existing = [...paths].filter((p) => fileRows.some((f) => f.path === p)).sort();
    survivingPathByFeature.set(featureId, existing[0]);
  }

  for (const issue of issues) {
    if (issue.kind === 'new_candidate') {
      const bare = issue.targetId.startsWith('symbol:') ? issue.targetId.slice('symbol:'.length) : issue.targetId;
      const range = symbolRangeByKey.get(bare);
      const sep = bare.lastIndexOf(':');
      const filePath = sep > 0 ? bare.slice(0, sep) : undefined;
      if (filePath && range) {
        issue.location = { filePath, startLine: range.startLine, endLine: range.endLine };
      } else if (filePath) {
        issue.location = { filePath, startLine: 1 };
      }
    } else {
      const anchor = survivingPathByFeature.get(issue.featureId);
      if (anchor) issue.location = { filePath: anchor, startLine: 1 };
    }
  }
}
