/**
 * Code graph inspection — Milestone 6 / v0.2.0 (docs/DEVELOPMENT_PLAN.md).
 *
 * `featuremap inspect <file>` reads stored evidence and reports the
 * file's graph neighborhood. Every line comes from evidence rows, so
 * the output is explainable by construction (AGENTS.md §15).
 */
import { eq, or, like, type SQL } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';

export interface GraphEdge {
  sourceId: string;
  relationType: string;
  targetId: string;
  confidence: number;
  analyzerId: string;
  usage?: string;
}

export interface InspectResult {
  file: string;
  /** Symbols declared in the file (CONTAINS), with export flag. */
  contains: Array<{ symbolId: string; kind: string }>;
  /** Symbols the file exports (REFERENCES, kind metadata). */
  exports: string[];
  /** Resolved repo-internal imports (file→file). */
  imports: string[];
  /** Repo-internal files importing this file. */
  importedBy: string[];
  /** Outgoing CALLS edges (from this file's file/symbol nodes). */
  calls: GraphEdge[];
  /** Incoming CALLS edges (targets inside this file). */
  calledBy: GraphEdge[];
  /** Component usages (REFERENCES with metadata.usage === 'component'). */
  componentUsage: GraphEdge[];
}

const symbolPrefix = (file: string): string => `symbol:${file}:`;

export function inspectFile(repoRoot: string, file: string, dbPathOverride?: string): InspectResult {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const prefix = symbolPrefix(file);
    // Rows touching the file itself or symbols declared inside it.
    const touchFile: SQL = or(
      eq(schema.evidence.sourceId, file),
      eq(schema.evidence.targetId, file),
      like(schema.evidence.sourceId, `${prefix}%`),
      like(schema.evidence.targetId, `${prefix}%`),
    )!;

    const rows = db.select().from(schema.evidence).where(touchFile).all();

    const contains: InspectResult['contains'] = [];
    const exports_: string[] = [];
    const imports: string[] = [];
    const importedBy: string[] = [];
    const calls: GraphEdge[] = [];
    const calledBy: GraphEdge[] = [];
    const componentUsage: GraphEdge[] = [];

    for (const row of rows) {
      const edge: GraphEdge = {
        sourceId: row.sourceId,
        relationType: row.relationType,
        targetId: row.targetId,
        confidence: row.confidence,
        analyzerId: row.analyzerId,
        usage: (row.metadata as { usage?: string } | null)?.usage,
      };

      if (row.relationType === 'CONTAINS' && row.sourceId === file && row.targetId.startsWith(prefix)) {
        contains.push({
          symbolId: row.targetId,
          kind: String((row.metadata as { kind?: string } | null)?.kind ?? 'unknown'),
        });
      } else if (
        row.relationType === 'REFERENCES' &&
        row.sourceId === file &&
        row.targetId.startsWith(prefix) &&
        edge.usage === undefined
      ) {
        exports_.push(row.targetId);
      } else if (row.relationType === 'IMPORTS') {
        if (row.sourceId === file) imports.push(row.targetId);
        if (row.targetId === file) importedBy.push(row.sourceId);
      } else if (row.relationType === 'CALLS') {
        const sourceInside =
          row.sourceId === file || row.sourceId.startsWith(prefix);
        const targetInside =
          row.targetId === file || row.targetId.startsWith(prefix);
        if (sourceInside) calls.push(edge);
        if (targetInside) calledBy.push(edge);
      } else if (row.relationType === 'REFERENCES' && edge.usage === 'component') {
        componentUsage.push(edge);
      }
    }

    return {
      file,
      contains,
      exports: exports_,
      imports: [...new Set(imports)].sort(),
      importedBy: [...new Set(importedBy)].sort(),
      calls,
      calledBy,
      componentUsage,
    };
  } finally {
    sqlite.close();
  }
}
