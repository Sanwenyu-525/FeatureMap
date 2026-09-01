/**
 * Incremental scan support — Milestone 9 (v0.2.4),
 * docs/DEVELOPMENT_PLAN.md and docs/releases/v0.2-acceptance.md §1/§3.
 *
 * The cache is keyed by `analyzerId:version:file hash:file-set signature`.
 * Unchanged files in an unchanged file set hit the cache and are never
 * re-parsed; adding or removing files changes the file-set signature and
 * degrades gracefully to a full re-analysis instead of producing stale
 * cross-file edges (correctness over speed).
 */
import { createHash } from 'node:crypto';
import { eq, notLike } from 'drizzle-orm';
import { schema, type FeatureMapDatabase } from '@featuremap/db';
import type { AnalysisCache } from '@featuremap/analyzer';

/** Stable signature of the repository file set (cheap to compute). */
export function fileSetKeyOf(paths: string[]): string {
  const joined = [...paths].sort().join('\n');
  return createHash('sha256').update(joined).digest('hex').slice(0, 16);
}

export class SqliteAnalysisCache implements AnalysisCache {
  constructor(private readonly db: FeatureMapDatabase) {}

  get(key: string): unknown | undefined {
    const row = this.db
      .select()
      .from(schema.analysisCache)
      .where(eq(schema.analysisCache.key, key))
      .all()[0];
    return row?.payload;
  }

  put(key: string, payload: unknown): void {
    this.db
      .insert(schema.analysisCache)
      .values({ key, payload })
      .onConflictDoUpdate({ target: schema.analysisCache.key, set: { payload } })
      .run();
  }

  /** Drop entries that do not belong to the current file-set signature. */
  prune(keepFileSetKey: string): void {
    this.db
      .delete(schema.analysisCache)
      .where(notLike(schema.analysisCache.key, `%:${keepFileSetKey}`))
      .run();
  }
}
