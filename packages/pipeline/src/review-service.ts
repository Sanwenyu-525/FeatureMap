/**
 * Review service (v0.6.4 plan §11–§16).
 *
 * Domain entry points for the IDE Review workflow. The only verdict
 * writer remains `setVerdict` (review.ts); these functions add DTO
 * shaping, deterministic ranking and an optimistic fingerprint check so
 * a stale QuickPick selection is never applied to changed evidence.
 */
import { and, eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { setVerdict, explainCandidate, type CandidateRow } from './review.js';

export interface SuggestionFilter {
  featureId?: string;
  targetType?: 'file' | 'symbol';
  limit?: number;
}

export interface SuggestedRelationDto {
  feature: { id: string; name: string };
  target: { type: 'file' | 'symbol'; id: string; label: string; location?: { filePath: string; startLine: number; endLine?: number } };
  relation: 'OWNS' | 'DEPENDS_ON';
  status: 'suggested';
  score: number;
  distance: number;
  fanIn: number;
  fingerprint: string;
  evidence: { available: boolean; count: number };
}

const DEFAULT_SUGGESTION_LIMIT = 50;

/** `path:name` → file path; bare file target → itself. */
function fileOfTarget(targetType: 'file' | 'symbol', targetId: string): string | undefined {
  if (targetType === 'file') return targetId;
  const colon = targetId.lastIndexOf(':');
  return colon > 0 ? targetId.slice(0, colon) : undefined;
}

function labelOfTarget(targetType: 'file' | 'symbol', targetId: string): string {
  if (targetType === 'file') return targetId;
  const colon = targetId.lastIndexOf(':');
  return colon > 0 ? targetId.slice(colon + 1) : targetId;
}

export function listSuggestedRelations(
  repoRoot: string,
  filter: SuggestionFilter = {},
  dbPathOverride?: string,
): SuggestedRelationDto[] {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const rows = db
      .select()
      .from(schema.featureCandidates)
      .where(eq(schema.featureCandidates.status, 'suggested'))
      .all();
    const filtered = rows.filter(
      (r) =>
        (filter.featureId === undefined || r.featureId === filter.featureId) &&
        (filter.targetType === undefined || r.targetType === filter.targetType),
    );
    const names = new Map(db.select().from(schema.features).all().map((f) => [f.id, f.name]));

    // Symbol ranges for location resolution.
    const symbolRangeByKey = new Map<string, { startLine: number; endLine?: number }>();
    const fileRows = db.select().from(schema.files).all();
    const pathById = new Map(fileRows.map((f) => [f.id, f.path]));
    for (const s of db.select().from(schema.symbols).all()) {
      const path = pathById.get(s.fileId);
      if (!path || s.startLine == null) continue;
      symbolRangeByKey.set(`${path}:${s.name}`, { startLine: s.startLine, endLine: s.endLine ?? undefined });
    }

    const chain = (c: CandidateRow): unknown[] => (c.evidenceChain ?? []) as unknown[];

    return filtered
      .sort((a, b) => {
        return (
          b.score - a.score ||
          a.distance - b.distance ||
          a.fanIn - b.fanIn ||
          a.featureId.localeCompare(b.featureId) ||
          labelOfTarget(a.targetType, a.targetId).localeCompare(labelOfTarget(b.targetType, b.targetId))
        );
      })
      .slice(0, filter.limit ?? DEFAULT_SUGGESTION_LIMIT)
      .map((c) => {
        const filePath = fileOfTarget(c.targetType, c.targetId);
        let location: SuggestedRelationDto['target']['location'];
        if (filePath) {
          if (c.targetType === 'symbol') {
            const range = symbolRangeByKey.get(`${filePath}:${labelOfTarget(c.targetType, c.targetId)}`);
            location = range
              ? { filePath, startLine: range.startLine, endLine: range.endLine }
              : { filePath, startLine: 1 };
          } else {
            location = { filePath, startLine: 1 };
          }
        }
        const evidenceChain = chain(c);
        return {
          feature: { id: c.featureId, name: names.get(c.featureId) ?? c.featureId },
          target: { type: c.targetType, id: c.targetId, label: labelOfTarget(c.targetType, c.targetId), location },
          relation: c.relation === 'owns' ? 'OWNS' : 'DEPENDS_ON',
          status: 'suggested',
          score: c.score,
          distance: c.distance,
          fanIn: c.fanIn,
          fingerprint: c.fingerprint ?? '',
          evidence: { available: evidenceChain.length > 0, count: evidenceChain.length },
        };
      });
  } finally {
    sqlite.close();
  }
}

export interface ReviewVerdictParams {
  featureId: string;
  target: { type: 'file' | 'symbol'; id: string };
  verdict: 'accepted' | 'rejected';
  /** Optimistic concurrency: reject if the candidate moved on (plan §15). */
  expectedFingerprint?: string;
}

export type ReviewVerdictResult =
  | { applied: true; candidate: { featureId: string; target: { type: string; id: string }; status: 'accepted' | 'rejected'; fingerprint: string } }
  | { applied: false; reason: 'candidate_changed'; currentCandidate?: SuggestedRelationDto };

export function applyReviewVerdict(
  repoRoot: string,
  params: ReviewVerdictParams,
  dbPathOverride?: string,
): ReviewVerdictResult {
  const targetId = params.target.id.replace(/^symbol:/, '');
  let row: CandidateRow | undefined;
  {
    const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
    try {
      row = db
        .select()
        .from(schema.featureCandidates)
        .where(
          and(
            eq(schema.featureCandidates.featureId, params.featureId),
            eq(schema.featureCandidates.targetType, params.target.type),
            eq(schema.featureCandidates.targetId, targetId),
          ),
        )
        .all()[0] as CandidateRow | undefined;
    } finally {
      sqlite.close();
    }
  }
  if (!row || row.status !== 'suggested') {
    return { applied: false, reason: 'candidate_changed' };
  }
  if (params.expectedFingerprint !== undefined && (row.fingerprint ?? '') !== params.expectedFingerprint) {
    return {
      applied: false,
      reason: 'candidate_changed',
      currentCandidate: listSuggestedRelations(repoRoot, { featureId: params.featureId }, dbPathOverride).find(
        (s) => s.target.id === targetId,
      ),
    };
  }
  // Outside the read transaction: the single verdict writer (review.ts).
  const updated = setVerdict(repoRoot, params.featureId, targetId, params.verdict, dbPathOverride);
  return {
    applied: true,
    candidate: {
      featureId: updated.featureId,
      target: { type: updated.targetType, id: updated.targetId },
      status: updated.status as 'accepted' | 'rejected',
      fingerprint: updated.fingerprint ?? '',
    },
  };
}

export interface ReviewExplainResult {
  feature: { id: string; name: string };
  target: { type: 'file' | 'symbol'; id: string; label: string };
  relation: 'OWNS' | 'DEPENDS_ON';
  score: number;
  status: string;
  evidenceChain: Array<{ relationType: string; sourceId: string; targetId: string; confidence: number }>;
}

export function explainReviewRelation(
  repoRoot: string,
  featureId: string,
  target: { type: 'file' | 'symbol'; id: string },
  dbPathOverride?: string,
): ReviewExplainResult {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  let name = featureId;
  try {
    name = db.select().from(schema.features).where(eq(schema.features.id, featureId)).all()[0]?.name ?? featureId;
  } finally {
    sqlite.close();
  }
  const result = explainCandidate(repoRoot, featureId, target.id.replace(/^symbol:/, ''), dbPathOverride);
  return {
    feature: { id: result.featureId, name },
    target: { type: result.targetType, id: result.targetId, label: labelOfTarget(result.targetType, result.targetId) },
    relation: result.relation === 'owns' ? 'OWNS' : 'DEPENDS_ON',
    score: result.score,
    status: result.status,
    evidenceChain: result.chain,
  };
}
