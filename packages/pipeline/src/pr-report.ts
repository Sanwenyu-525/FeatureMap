/**
 * `featuremap pr` — feature-centric pull-request report (Phase 4, v0.4.0).
 *
 * A PR is modelled as the same change source as `impact` (a commit
 * range like `main..HEAD`, or the working tree when no range is given).
 * On top of the impact traversal the report adds four things:
 *
 *  1. **Risk band** (HIGH / MEDIUM / LOW) — rule-based with every
 *     contribution carrying its reason; never an opaque percentage
 *     (AGENTS.md §7, ADR-0004 §3).
 *  2. **Test coverage** — which recommended tests actually changed in
 *     the diff (✓) vs unchanged (⚠ potential missing coverage). The
 *     wording is "potential", never "tests missing": a test change is
 *     not always required.
 *  3. **Mapping drift** — deterministic signals that feature metadata
 *     may be stale: accepted/declared relations whose file was deleted
 *     or renamed (relation_broken), plus changed symbols inside owned
 *     files that are not yet confirmed (new_candidate). Detection is
 *     deterministic; creation stays a human decision (detect → suggest
 *     → confirm, ADR-0002 §2).
 *  4. Existing warnings (documentation drift, suppressed uncertainty)
 *     are carried through unchanged.
 *
 * The analysis is local and transport-free: a GitHub Check or comment
 * is a thin consumer of the same report (Phase 4 later milestones).
 */
import { eq, inArray } from 'drizzle-orm';
import { openDatabase, defaultDatabasePath, schema } from '@featuremap/db';
import { analyzeImpact, type ImpactResult } from './impact.js';
import { computeDrift } from './drift/compute-drift.js';
import type { DriftKind } from './drift/drift-types.js';

export type RiskBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RiskContribution {
  points: number;
  reason: string;
}

export interface PrRisk {
  band: RiskBand;
  contributions: RiskContribution[];
}

export interface PrTestCoverage {
  path: string;
  status: 'recommended' | 'related';
  featureId: string;
  /** True when this test path changed in the diff (✓); false = potential missing coverage (⚠). */
  changed: boolean;
}

export interface MappingDrift {
  kind: DriftKind;
  featureId: string;
  featureName?: string;
  targetId: string;
  targetType: 'file' | 'symbol';
  reason: string;
}

export interface PrReport {
  range?: string;
  currentBranch?: string;
  baseBranch?: string;
  changedFiles: ImpactResult['changedFiles'];
  affectedFeatures: ImpactResult['affectedFeatures'];
  sharedInfrastructure: ImpactResult['sharedInfrastructure'];
  suppressedUncertainty: ImpactResult['suppressedUncertainty'];
  risk: PrRisk;
  testCoverage: PrTestCoverage[];
  mappingDrift: MappingDrift[];
  staleDocuments: ImpactResult['potentiallyStaleDocuments'];
}

export interface PrOptions {
  range?: string;
  dbPath?: string;
}

/**
 * Risk rule table (points are explainable increments, never summed into
 * a percentage):
 *
 *   direct core feature change      +1  (a HIGH-severity affected feature)
 *   public API / route change       +1  (an endpoint / cli_command asset changed)
 *   shared dependency change        +1  (shared infrastructure touched)
 *   database schema change          +1  (schema/migration/prisma/sql path)
 *   related tests not changed       +1  (feature has tests, none changed)
 *   many features affected          +1  (≥ 3 HIGH/MEDIUM)
 *
 * Band mapping: ≥ 4 → HIGH, 2–3 → MEDIUM, ≤ 1 → LOW.
 */
const SCHEMA_PATH_PATTERN = /(^|\/)(schema|migrations?|migration)(\/|\.)|\.prisma$|\.sql$|drizzle/i;
const MANY_FEATURES_THRESHOLD = 3;
const RISK_HIGH_POINTS = 4;
const RISK_MEDIUM_POINTS = 2;

function deriveRisk(impact: ImpactResult, changedPaths: ReadonlySet<string>, publicApiChanged: boolean): PrRisk {
  const contributions: RiskContribution[] = [];
  const highMedium = impact.affectedFeatures.filter((f) => f.severity !== 'LOW');

  const high = highMedium.filter((f) => f.severity === 'HIGH');
  if (high.length > 0) {
    contributions.push({
      points: 1,
      reason: `直接核心功能变更：${high.map((f) => f.featureName).join('、')}`,
    });
  }
  if (publicApiChanged) {
    contributions.push({ points: 1, reason: '公共 API / 路由 / CLI 入口变更' });
  }
  if (impact.sharedInfrastructure.length > 0) {
    contributions.push({
      points: 1,
      reason: `共享依赖变更：${impact.sharedInfrastructure.map((s) => s.path).join('、')}`,
    });
  }
  const schemaPaths = [...changedPaths].filter((p) => SCHEMA_PATH_PATTERN.test(p));
  if (schemaPaths.length > 0) {
    contributions.push({ points: 1, reason: `数据库结构变更：${schemaPaths.join('、')}` });
  }
  // Only when the feature has tests to change — a feature with no tests
  // at all is a separate health signal, not a coverage-miss warning.
  const featuresWithUnchangedTests = highMedium.filter(
    (f) => f.tests.length > 0 && !f.tests.some((t) => changedPaths.has(t)),
  );
  if (featuresWithUnchangedTests.length > 0) {
    contributions.push({
      points: 1,
      reason: `相关测试未变更：${featuresWithUnchangedTests
        .map((f) => `${f.featureName} (${f.tests.join(', ')})`)
        .join('；')}`,
    });
  }
  if (highMedium.length >= MANY_FEATURES_THRESHOLD) {
    contributions.push({
      points: 1,
      reason: `多个功能受影响（${highMedium.length} 个 HIGH/MEDIUM）`,
    });
  }

  const points = contributions.reduce((sum, c) => sum + c.points, 0);
  const band: RiskBand =
    points >= RISK_HIGH_POINTS ? 'HIGH' : points >= RISK_MEDIUM_POINTS ? 'MEDIUM' : 'LOW';
  return { band, contributions };
}

export async function buildPrReport(repoRoot: string, options: PrOptions = {}): Promise<PrReport> {
  const { range, dbPath: dbPathOverride } = options;
  const dbPath = dbPathOverride ?? defaultDatabasePath(repoRoot);
  const impact = await analyzeImpact(repoRoot, { range, dbPath });

  const changedPaths = new Set(impact.changedFiles.map((c) => c.path));
  const changeTypeByPath = new Map(impact.changedFiles.map((c) => [c.path, c.changeType]));

  // ---- Test coverage: recommended tests vs actually changed -----------
  const testCoverage: PrTestCoverage[] = impact.recommendedTests.map((t) => ({
    path: t.path,
    status: t.status,
    featureId: t.featureId,
    changed: changedPaths.has(t.path),
  }));

  // ---- Drift / risk metadata queries ----------------------------------
  const { db, sqlite } = openDatabase(dbPath);
  try {
    const featureName = new Map(db.select().from(schema.features).all().map((f) => [f.id, f.name]));

    // Public API signal: changed files that are endpoint / cli_command
    // assets (deterministic route & CLI anchor facts).
    const apiAssetPaths = new Set(
      db
        .select()
        .from(schema.assets)
        .where(inArray(schema.assets.type, ['endpoint', 'cli_command']))
        .all()
        .map((a) => a.path)
        .filter((p): p is string => !!p),
    );
    const publicApiChanged = [...changedPaths].some((p) => apiAssetPaths.has(p));

    // Feature ownership (file paths per feature) + test paths (to avoid
    // suggesting test-internal symbols as feature candidates).
    const ownedFilesByFeature = new Map<string, Set<string>>();
    const testPaths = new Set<string>();
    const assetByPath = new Map<string, string>();
    for (const asset of db.select().from(schema.assets).all()) {
      if (asset.path) assetByPath.set(asset.path, asset.type);
      if (asset.type === 'test' && asset.path) testPaths.add(asset.path);
    }
    for (const fa of db.select().from(schema.featureAssets).all()) {
      const asset = db.select().from(schema.assets).where(eq(schema.assets.id, fa.assetId)).all()[0];
      if (!asset?.path) continue;
      const set = ownedFilesByFeature.get(fa.featureId) ?? new Set<string>();
      set.add(asset.path);
      ownedFilesByFeature.set(fa.featureId, set);
    }

    // Accepted/declared relations = user facts (review workflow + anchors).
    const confirmed = db
      .select()
      .from(schema.featureCandidates)
      .where(inArray(schema.featureCandidates.status, ['accepted', 'declared']))
      .all();

    // Drift is computed by the shared ADR-0005 detector so the PR report
    // and the IDE diagnostics can never diverge (v0.6.4 plan §1.2).
    const drift: MappingDrift[] = computeDrift({
      confirmed: confirmed.map((c) => ({
        featureId: c.featureId,
        targetType: c.targetType,
        targetId: c.targetId,
        status: c.status,
        score: c.score,
        fingerprint: c.fingerprint,
      })),
      changeTypeByPath,
      changedSymbols: impact.changedSymbols,
      ownedFilesByFeature,
      testPaths,
      featureNames: featureName,
    }).map((d) => ({
      kind: d.kind,
      featureId: d.featureId,
      featureName: d.featureName,
      targetId: d.targetId,
      targetType: d.targetType,
      reason: d.reason,
    }));

    const risk = deriveRisk(impact, changedPaths, publicApiChanged);

    return {
      range,
      currentBranch: impact.currentBranch,
      baseBranch: impact.baseBranch,
      changedFiles: impact.changedFiles,
      affectedFeatures: impact.affectedFeatures,
      sharedInfrastructure: impact.sharedInfrastructure,
      suppressedUncertainty: impact.suppressedUncertainty,
      risk,
      testCoverage,
      mappingDrift: drift,
      staleDocuments: impact.potentiallyStaleDocuments,
    };
  } finally {
    sqlite.close();
  }
}
