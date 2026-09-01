/**
 * Test seeding helpers — the six Phase 5 fixtures are seeded as DB rows
 * (feature_candidates status/score/distance/fanIn + evidence + assets),
 * because CONTEXT is a projection of the graph: what the tests observe
 * is exactly what ranking/budget receive. Fixtures map to existing
 * fixture repositories where possible:
 *
 *   simple-login        01-simple-login           (S1)
 *   login-with-session  06-cross-feature          (S2)
 *   shared-infrastructure 04-shared-utils         (S3)
 *   large-feature       synthesized               (S4)
 *   monorepo-feature    05-monorepo               (S5)
 *   task-aware-login    06-cross-feature + task   (S6)
 */
import { assetId, evidenceId } from '@featuremap/analyzer';
import { schema, type FeatureMapDatabase } from '@featuremap/db';
import { eq } from 'drizzle-orm';

export const PROJECT_ID = 'p1';

export function seedProject(db: FeatureMapDatabase): void {
  db.insert(schema.projects)
    .values({ id: PROJECT_ID, name: 'demo', root: '/tmp/demo', baseBranch: 'main' })
    .run();
}

/** Insert a file + its file asset (+ optional symbol). Returns the asset id. */
export function seedFile(
  db: FeatureMapDatabase,
  path: string,
  options: { type?: string; name?: string; confidence?: number; featureId?: string } = {},
): string {
  const id = assetId({ type: options.type ?? 'file', path });
  db.insert(schema.files).values({ id, projectId: PROJECT_ID, path, language: 'typescript' }).run();
  db.insert(schema.assets)
    .values({
      id,
      type: options.type ?? 'file',
      path,
      name: options.name,
      metadata: options.type === 'endpoint' || options.type === 'cli_command' ? { method: 'POST' } : undefined,
    })
    .run();
  return id;
}

/** Insert a symbol row; returns the bare symbol id (`path:name`). */
export function seedSymbol(
  db: FeatureMapDatabase,
  path: string,
  name: string,
  kind = 'function',
  startLine = 1,
  endLine = 10,
): string {
  const fileRow = db.select().from(schema.files).where(eq(schema.files.path, path)).all()[0];
  if (!fileRow) throw new Error(`seedSymbol: file ${path} not seeded first`);
  const symId = `symbol:${path}:${name}`;
  db.insert(schema.symbols)
    .values({ id: symId, fileId: fileRow.id, name, kind, startLine, endLine })
    .run();
  return `${path}:${name}`;
}

export function seedFeature(
  db: FeatureMapDatabase,
  id: string,
  name: string,
  pattern = 'Authentication',
  description?: string,
): void {
  db.insert(schema.features)
    .values({ id, name, pattern, confidence: 0.9, description })
    .run();
}

export function seedFeatureAsset(
  db: FeatureMapDatabase,
  featureId: string,
  assetIdValue: string,
  confidence: number,
): void {
  db.insert(schema.featureAssets)
    .values({ featureId, assetId: assetIdValue, confidence })
    .run();
}

export interface SeedCandidateInput {
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  relation: 'owns' | 'DEPENDS_ON';
  status: 'declared' | 'suggested' | 'accepted' | 'rejected';
  score: number;
  distance?: number;
  fanIn?: number;
  chain?: Array<{ relationType: string; sourceId: string; targetId: string; confidence: number }>;
}

export function seedCandidate(db: FeatureMapDatabase, input: SeedCandidateInput): void {
  const chain = input.chain ?? [];
  const fingerprint = chain.length > 0 ? chain.map((s) => s.targetId).join('|').slice(0, 16) : null;
  db.insert(schema.featureCandidates)
    .values({
      id: `cand:${input.featureId}:${input.targetType}:${input.targetId}`,
      featureId: input.featureId,
      targetType: input.targetType,
      targetId: input.targetId,
      relation: input.relation,
      status: input.status,
      score: input.score,
      distance: input.distance ?? 0,
      fanIn: input.fanIn ?? 1,
      evidenceChain: chain,
      fingerprint,
    })
    .run();
}

export function seedBelongsToEvidence(
  db: FeatureMapDatabase,
  featureId: string,
  sourceId: string,
  confidence: number,
  analyzerId = 'typescript',
  origin: 'deterministic' | 'semantic' | 'manual' = 'semantic',
): void {
  db.insert(schema.evidence)
    .values({
      id: evidenceId({
        sourceType: 'file',
        sourceId,
        relationType: 'BELONGS_TO_FEATURE',
        targetType: 'feature',
        targetId: featureId,
        analyzerId,
      }),
      sourceType: 'file',
      sourceId,
      relationType: 'BELONGS_TO_FEATURE',
      targetType: 'feature',
      targetId: featureId,
      confidence,
      analyzerId,
      origin,
    })
    .run();
}

/** IMPORTS edge used by dependents / fan-in accounting. */
export function seedImports(db: FeatureMapDatabase, from: string, to: string, confidence = 1, analyzerId = 'typescript'): void {
  const id = evidenceId({
    sourceType: 'file',
    sourceId: from,
    relationType: 'IMPORTS',
    targetType: 'file',
    targetId: to,
    analyzerId,
  });
  const existing = db.select().from(schema.evidence).where(eq(schema.evidence.id, id)).all();
  if (existing.length === 0) {
    db.insert(schema.evidence)
      .values({
        id,
        sourceType: 'file',
        sourceId: from,
        relationType: 'IMPORTS',
        targetType: 'file',
        targetId: to,
        confidence,
        analyzerId,
        origin: 'deterministic',
      })
      .run();
  }
}

/** A repository instruction scoped to a feature (policies/constraints). */
export function seedInstruction(
  db: FeatureMapDatabase,
  featureId: string,
  text: string,
  options: { level?: 'required' | 'recommended' | 'informational'; documentPath?: string; scope?: string } = {},
): void {
  const docPath = options.documentPath ?? 'AGENTS.md';
  const doc = db.select().from(schema.documents).where(eq(schema.documents.path, docPath)).all()[0];
  const documentId = doc?.id ?? `doc:${docPath}`;
  if (!doc) {
    db.insert(schema.documents)
      .values({ id: documentId, path: docPath, type: docPath === 'AGENTS.md' ? 'agents' : 'docs', title: docPath })
      .run();
  }
  const instructionId = `instr:${docPath}:${policiesHash(text)}`;
  db.insert(schema.instructions)
    .values({
      id: instructionId,
      documentId,
      text,
      level: options.level ?? 'recommended',
      scope: options.scope,
      confidence: 1,
    })
    .run();
  db.insert(schema.featureInstructions).values({ featureId, instructionId }).run();
}

function policiesHash(text: string): string {
  let h = 0;
  for (const ch of text) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 1_000_000_007;
  }
  return String(h);
}

export interface SeedCommitInput {
  sha: string;
  message: string;
  author?: string;
  committedAt?: string;
  paths: string[];
}

export function seedCommit(db: FeatureMapDatabase, input: SeedCommitInput): void {
  const committedAt = input.committedAt ?? new Date().toISOString();
  const existing = db.select().from(schema.commits).where(eq(schema.commits.sha, input.sha)).all();
  if (existing.length === 0) {
    db.insert(schema.commits)
      .values({
        sha: input.sha,
        projectId: PROJECT_ID,
        author: input.author ?? 'tester',
        message: input.message,
        committedAt,
      })
      .run();
  }
  for (const path of input.paths) {
    db.insert(schema.commitFiles).values({ commitSha: input.sha, path, changeType: 'modified' }).run();
  }
}

/** Endpoint asset helper (entry point). */
export function seedEndpoint(db: FeatureMapDatabase, name: string, path?: string): string {
  return seedFile(db, path ?? `src/api/${slug(name)}.ts`, { type: 'endpoint', name, featureId: undefined });
}

export function seedDocument(db: FeatureMapDatabase, path: string, type: string): void {
  db.insert(schema.documents).values({ id: `doc:${path}`, path, type, title: path }).run();
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}