/**
 * Review workflow — Milestone 8 (v0.2.3), ADR-0003 §4.
 *
 * Human verdicts close the loop between suggestions and judgment:
 * manual correction outranks any inference, verdicts survive rescans,
 * and `explain` renders the evidence chain behind any score
 * (AGENTS.md §15: always answer "why").
 */
import { and, eq } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { slugify } from './feature-discovery.js';

export type CandidateStatus =
  | 'declared'
  | 'suggested'
  | 'accepted'
  | 'rejected'
  | 'superseded';

export interface CandidateRow {
  id: string;
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  relation: 'owns' | 'DEPENDS_ON';
  status: CandidateStatus;
  score: number;
  distance: number;
  fanIn: number;
  evidenceChain: Array<{
    relationType: string;
    sourceId: string;
    targetId: string;
    confidence: number;
  }>;
  fingerprint: string | null;
  updatedAt: string;
}

export interface ExplainResult {
  featureId: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  relation: 'owns' | 'DEPENDS_ON';
  status: CandidateStatus;
  score: number;
  distance: number;
  fanIn: number;
  chain: CandidateRow['evidenceChain'];
  fingerprint: string | null;
}

export class ReviewError extends Error {
  constructor(
    public readonly code: 'FEATURE_NOT_FOUND' | 'CANDIDATE_NOT_FOUND' | 'AMBIGUOUS_TARGET' | 'ANCHOR_NOT_REVIEWABLE',
    message: string,
  ) {
    super(message);
  }
}

function resolveFeatureId(db: ReturnType<typeof openDatabase>['db'], nameOrId: string): string {
  const fid = nameOrId.startsWith('feature:') ? nameOrId : `feature:${slugify(nameOrId)}`;
  const exists =
    db.select().from(schema.features).where(eq(schema.features.id, fid)).all().length > 0;
  if (!exists) {
    throw new ReviewError('FEATURE_NOT_FOUND', `Feature "${nameOrId}" (${fid}) does not exist. Run "featuremap scan" first.`);
  }
  return fid;
}

/** Exact targetId first, then a unique bare-symbol-name match, then a unique qualified name (Class.member) resolved through CONTAINS evidence. */
function findCandidateRow(
  db: ReturnType<typeof openDatabase>['db'],
  featureId: string,
  target: string,
): CandidateRow {
  const rows = db
    .select()
    .from(schema.featureCandidates)
    .where(eq(schema.featureCandidates.featureId, featureId))
    .all() as CandidateRow[];

  const exact = rows.find((r) => r.targetId === target);
  if (exact) return exact;

  const byBareName = rows.filter((r) => r.targetId.endsWith(`:${target}`));
  if (byBareName.length === 1) return byBareName[0]!;
  if (byBareName.length > 1) {
    throw new ReviewError(
      'AMBIGUOUS_TARGET',
      `Target "${target}" matches several candidates; use the full id (${byBareName.map((r) => r.targetId).join(', ')}).`,
    );
  }

  // Qualified symbol name (acceptance §5 step 6: `explain login
  // UserRepository.findByEmail`). Resolve Class.member through the
  // CONTAINS evidence: the candidate's symbol id must be the target of
  // a CONTAINS edge whose source ends with :<Class>.
  if (target.includes('.')) {
    const dot = target.lastIndexOf('.');
    const className = target.slice(0, dot);
    const memberName = target.slice(dot + 1);
    const memberMatches = rows.filter(
      (r) => r.targetType === 'symbol' && r.targetId.endsWith(`:${memberName}`),
    );
    const qualified = memberMatches.filter((r) => {
      const contains = db
        .select()
        .from(schema.evidence)
        .where(and(eq(schema.evidence.relationType, 'CONTAINS'), eq(schema.evidence.targetId, `symbol:${r.targetId}`)))
        .all();
      return contains.some((e) => e.sourceId.endsWith(`:${className}`));
    });
    if (qualified.length === 1) return qualified[0]!;
    if (qualified.length > 1) {
      throw new ReviewError(
        'AMBIGUOUS_TARGET',
        `Target "${target}" matches several candidates; use the full id (${qualified.map((r) => r.targetId).join(', ')}).`,
      );
    }
  }

  throw new ReviewError(
    'CANDIDATE_NOT_FOUND',
    `No candidate "${target}" for ${featureId}. Run "featuremap scan ${slugify(featureId.replace(/^feature:/, ''))}" to list candidates.`,
  );
}

/**
 * Record a human verdict. Declared anchors are user-written facts and
 * cannot be reviewed.
 */
export function setVerdict(
  repoRoot: string,
  featureNameOrId: string,
  target: string,
  verdict: 'accepted' | 'rejected',
  dbPathOverride?: string,
): CandidateRow {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const featureId = resolveFeatureId(db, featureNameOrId);
    const row = findCandidateRow(db, featureId, target);
    if (row.status === 'declared') {
      throw new ReviewError(
        'ANCHOR_NOT_REVIEWABLE',
        `"${row.targetId}" is a declared anchor; anchors are user-written facts and cannot be ${verdict}. Remove the anchor from featuremap.yaml instead.`,
      );
    }
    const updated: CandidateRow = { ...row, status: verdict, updatedAt: new Date().toISOString() };
    db.update(schema.featureCandidates)
      .set({ status: verdict, updatedAt: updated.updatedAt })
      .where(and(eq(schema.featureCandidates.featureId, featureId), eq(schema.featureCandidates.id, row.id)))
      .run();
    return updated;
  } finally {
    sqlite.close();
  }
}

/** Full evidence chain behind a candidate score. */
export function explainCandidate(
  repoRoot: string,
  featureNameOrId: string,
  target: string,
  dbPathOverride?: string,
): ExplainResult {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    const featureId = resolveFeatureId(db, featureNameOrId);
    const row = findCandidateRow(db, featureId, target);
    return {
      featureId: row.featureId,
      targetId: row.targetId,
      targetType: row.targetType,
      relation: row.relation,
      status: row.status,
      score: row.score,
      distance: row.distance,
      fanIn: row.fanIn,
      chain: row.evidenceChain,
      fingerprint: row.fingerprint,
    };
  } finally {
    sqlite.close();
  }
}

/** All candidates of one feature (or every feature when omitted). */
export function listCandidates(
  repoRoot: string,
  featureNameOrId?: string,
  dbPathOverride?: string,
): CandidateRow[] {
  const { db, sqlite } = openDatabase(dbPathOverride ?? defaultDatabasePath(repoRoot));
  try {
    if (featureNameOrId === undefined) {
      return db.select().from(schema.featureCandidates).all() as CandidateRow[];
    }
    const featureId = resolveFeatureId(db, featureNameOrId);
    return db
      .select()
      .from(schema.featureCandidates)
      .where(eq(schema.featureCandidates.featureId, featureId))
      .all() as CandidateRow[];
  } finally {
    sqlite.close();
  }
}
