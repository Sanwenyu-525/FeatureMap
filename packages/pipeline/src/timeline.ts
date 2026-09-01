/**
 * Feature timeline — Milestone 14 (docs/DEVELOPMENT_PLAN.md), ADR-0004 §6.
 *
 * Per-feature history is **derived** at query time from the stored git
 * log window and the feature's asset paths — never materialized into a
 * feature×commit table, keeping one source of truth and avoiding stale
 * snapshots. Each entry is traceable to its commit and its feature
 * mapping evidence (the asset paths that matched).
 */
import { eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';

export interface TimelineCommit {
  sha: string;
  author: string;
  email?: string;
  committedAt?: string;
  message?: string;
  /** Conventional-commit prefix (feat/fix/docs/…) parsed from the subject. */
  kind: string;
  /** Asset paths of this feature that the commit touched. */
  changedPaths: string[];
}

export interface ContributorStat {
  name: string;
  count: number;
}

export interface FeatureTimelineResult {
  featureId: string;
  featureName?: string;
  commits: TimelineCommit[];
  contributors: ContributorStat[];
  stats: {
    commitCount: number;
    fileCount: number;
    contributorCount: number;
    changeKinds: Record<string, number>;
  };
}

const KNOWN_KINDS = new Set([
  'feat',
  'fix',
  'docs',
  'refactor',
  'chore',
  'test',
  'perf',
  'build',
  'ci',
  'style',
  'revert',
]);

function kindOf(message: string | null | undefined): string {
  const prefix = /^([a-z]+)[:( ]/.exec(message?.trim() ?? '')?.[1]?.toLowerCase() ?? '';
  return KNOWN_KINDS.has(prefix) ? prefix : 'other';
}

export function featureTimeline(
  repoRoot: string,
  featureId: string,
  dbPathOverride?: string,
): FeatureTimelineResult {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const feature = db.select().from(schema.features).where(eq(schema.features.id, featureId)).all()[0];
    if (!feature) {
      throw new Error(`Feature "${featureId}" does not exist.`);
    }

    // The feature's asset paths: the mapping evidence for every commit match.
    const paths = new Set<string>();
    for (const fa of db
      .select()
      .from(schema.featureAssets)
      .where(eq(schema.featureAssets.featureId, featureId))
      .all()) {
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
      if (asset?.path) paths.add(asset.path);
    }

    const emptyStats = { commitCount: 0, fileCount: 0, contributorCount: 0, changeKinds: {} };
    if (paths.size === 0) {
      return { featureId, featureName: feature.name, commits: [], contributors: [], stats: emptyStats };
    }

    const commits: TimelineCommit[] = [];
    for (const c of db.select().from(schema.commits).all()) {
      const changedPaths = db
        .select()
        .from(schema.commitFiles)
        .where(eq(schema.commitFiles.commitSha, c.sha))
        .all()
        .map((r) => r.path)
        .filter((p) => paths.has(p));
      if (changedPaths.length === 0) continue;
      commits.push({
        sha: c.sha,
        author: c.author ?? 'unknown',
        email: c.email ?? undefined,
        committedAt: c.committedAt ?? undefined,
        message: c.message ?? undefined,
        kind: kindOf(c.message),
        changedPaths,
      });
    }
    // committed_at is an ISO-8601 string → lexicographic sort is chronological.
    commits.sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''));

    const byAuthor = new Map<string, number>();
    for (const c of commits) byAuthor.set(c.author, (byAuthor.get(c.author) ?? 0) + 1);
    const contributors: ContributorStat[] = [...byAuthor.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const changeKinds: Record<string, number> = {};
    for (const c of commits) changeKinds[c.kind] = (changeKinds[c.kind] ?? 0) + 1;

    return {
      featureId,
      featureName: feature.name,
      commits,
      contributors,
      stats: {
        commitCount: commits.length,
        fileCount: new Set(commits.flatMap((c) => c.changedPaths)).size,
        contributorCount: byAuthor.size,
        changeKinds,
      },
    };
  } finally {
    sqlite.close();
  }
}