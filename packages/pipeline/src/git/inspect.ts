/**
 * `featuremap git inspect <commit-ish>` (ADR-0004 §1, Milestone 10).
 *
 * Reports the raw change model for one commit: metadata from the
 * stored scan, per-file change rows, and changed symbols derived by
 * intersecting on-demand diff hunks with the stored symbol line spans.
 * The depth answer is always backed by evidence (AGENTS.md §15).
 */
import { $ } from 'execa';
import { eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { hunksForCommit } from './hunks.js';
import { extractChangedSymbols, type SymbolSpan } from './changed-symbols.js';

export interface InspectCommitSymbol {
  symbolId: string;
  name: string;
  path: string;
  kind: string;
  startLine: number;
  endLine: number;
  lines: number[];
}

export interface InspectCommitResult {
  sha: string;
  author?: string;
  email?: string;
  committedAt?: string;
  message?: string;
  /**
   * True when the inspected commit is not the current HEAD: symbol line
   * spans come from the latest scan of the working tree and may have
   * drifted since this commit (ADR-0004 §2).
   */
  approximate: boolean;
  changedFiles: Array<{ path: string; changeType: string }>;
  changedSymbols: InspectCommitSymbol[];
}

export async function inspectCommit(
  repoRoot: string,
  commitIsh: string,
  dbPathOverride?: string,
): Promise<InspectCommitResult> {
  // Resolve the commit-ish; a failure here is an invalid commit.
  const { stdout: shaOut } = await $`git -C ${repoRoot} rev-parse ${commitIsh}`;
  const sha = shaOut.trim();

  let headSha: string | undefined;
  try {
    const { stdout } = await $`git -C ${repoRoot} rev-parse HEAD`;
    headSha = stdout.trim();
  } catch {
    // Detached or unborn HEAD: no exact-match guarantee.
  }
  const approximate = headSha !== undefined && sha !== headSha;

  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const commitRow = db.select().from(schema.commits).where(eq(schema.commits.sha, sha)).all()[0];
    const fileRows = db
      .select()
      .from(schema.commitFiles)
      .where(eq(schema.commitFiles.commitSha, sha))
      .all();

    // Symbol spans from the latest scan (file path joined in).
    const symbolRows = db
      .select({
        id: schema.symbols.id,
        name: schema.symbols.name,
        kind: schema.symbols.kind,
        startLine: schema.symbols.startLine,
        endLine: schema.symbols.endLine,
        path: schema.files.path,
      })
      .from(schema.symbols)
      .innerJoin(schema.files, eq(schema.symbols.fileId, schema.files.id))
      .all();

    const spans: SymbolSpan[] = symbolRows
      .filter((r) => r.startLine !== null && r.endLine !== null)
      .map((r) => ({
        symbolId: r.id,
        name: r.name,
        kind: r.kind,
        path: r.path,
        startLine: r.startLine as number,
        endLine: r.endLine as number,
      }));

    const hunks = await hunksForCommit(repoRoot, sha);
    const changedSymbols = extractChangedSymbols(hunks, spans).map((s) => ({ ...s }));

    return {
      sha,
      author: commitRow?.author ?? undefined,
      email: commitRow?.email ?? undefined,
      committedAt: commitRow?.committedAt ?? undefined,
      message: commitRow?.message ?? undefined,
      approximate,
      changedFiles: fileRows.map((f) => ({ path: f.path, changeType: f.changeType })),
      changedSymbols,
    };
  } finally {
    sqlite.close();
  }
}