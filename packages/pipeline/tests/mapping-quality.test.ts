/**
 * Mapping-quality measurement tests — docs/releases/v0.2-acceptance.md §2.
 *
 * The synthetic case pins the metric computation (exact P/R numbers).
 * The fixture cases run the real scan pipeline against the ground-truth
 * fixtures and pin the *current* engine behavior as a regression
 * baseline. They deliberately assert today's known gaps — when
 * Milestone 7 (anchor-driven candidate scoring) lands, these flip into
 * the Quality Gate thresholds from the acceptance document.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  loadGroundTruth,
  measureFileMapping,
  measureSymbolMapping,
  runScan,
  type GroundTruth,
  type MappingMetrics,
  type ScanJsonOutput,
} from '../src/index.js';

const FIXTURES_ROOT = fileURLToPath(new URL('../../../test-fixtures', import.meta.url));
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-mq-'));
  tempDirs.push(dir);
  return join(dir, 'featuremap.db');
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const fixtureRoot = (name: string): string => join(FIXTURES_ROOT, name);

describe('measureFileMapping — metric computation', () => {
  const truth: GroundTruth = {
    feature: 'login',
    anchors: [],
    expected: [],
    notExpected: ['c'],
    expectedFiles: ['src/a.ts', 'src/b.ts', 'src/e.ts'],
    notExpectedFiles: ['src/c.ts'],
  };

  const fakeScan = {
    features: [{ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9, health: {} }],
    endpoints: [{ name: 'POST /api/login', path: 'src/server.ts' }],
    evidence: [
      { relationType: 'BELONGS_TO_FEATURE', targetId: 'feature:login', sourceType: 'file', sourceId: 'src/a.ts' },
      { relationType: 'BELONGS_TO_FEATURE', targetId: 'feature:login', sourceType: 'file', sourceId: 'src/b.ts' },
      { relationType: 'BELONGS_TO_FEATURE', targetId: 'feature:login', sourceType: 'file', sourceId: 'src/c.ts' },
      { relationType: 'BELONGS_TO_FEATURE', targetId: 'feature:login', sourceType: 'file', sourceId: 'src/d.ts' },
      {
        relationType: 'BELONGS_TO_FEATURE',
        targetId: 'feature:login',
        sourceType: 'endpoint',
        sourceId: 'endpoint:POST /api/login',
      },
    ],
  } as unknown as ScanJsonOutput;

  it('computes exact precision/recall and classifies candidates', () => {
    const metrics = measureFileMapping(fakeScan, truth);
    // Candidates: a, b, c, d, server.ts — e is missing.
    expect(metrics.candidates).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
      'src/d.ts',
      'src/server.ts',
    ]);
    expect(metrics.truePositives).toEqual(['src/a.ts', 'src/b.ts']);
    // c is notExpected; d and server.ts are unclassified ground truth.
    expect(metrics.falsePositives).toEqual(['src/c.ts', 'src/d.ts', 'src/server.ts']);
    expect(metrics.unclassified).toEqual(['src/d.ts', 'src/server.ts']);
    expect(metrics.falseNegatives).toEqual(['src/e.ts']);
    expect(metrics.precision).toBeCloseTo(2 / 5);
    expect(metrics.recall).toBeCloseTo(2 / 3);
    expect(metrics.pending).toBe(false);
  });

  it('reports pending metrics when the scan found no feature', () => {
    const emptyScan = { features: [], endpoints: [], evidence: [] } as unknown as ScanJsonOutput;
    const metrics = measureFileMapping(emptyScan, truth);
    expect(metrics.featureId).toBe('feature:login');
    expect(metrics.candidates).toEqual([]);
    expect(metrics.recall).toBe(0);
    expect(metrics.precision).toBe(1); // no candidates → no false positives
  });

  it('measures symbol-level candidates with qualified method names', () => {
    const symbolTruth: GroundTruth = {
      ...truth,
      expected: ['AuthService.login', 'login'],
      notExpected: ['logger'],
      expectedFiles: [],
      notExpectedFiles: [],
    };
    const scanWithCandidates = {
      features: [{ id: 'feature:login', name: 'Login', pattern: 'Authentication', confidence: 0.9, health: {} }],
      endpoints: [],
      evidence: [
        {
          relationType: 'CONTAINS',
          sourceType: 'symbol',
          sourceId: 'symbol:src/auth.ts:AuthService',
          targetType: 'symbol',
          targetId: 'symbol:src/auth.ts:login',
          confidence: 1.0,
          metadata: { kind: 'method', member: true },
        },
      ],
      candidates: [
        {
          featureId: 'feature:login',
          targetType: 'symbol',
          targetId: 'src/auth.ts:login',
          relation: 'DEPENDS_ON',
          status: 'suggested',
          score: 0.65,
          distance: 2,
          fanIn: 0,
        },
        {
          featureId: 'feature:login',
          targetType: 'symbol',
          targetId: 'src/shared/logger.ts:logger',
          relation: 'DEPENDS_ON',
          status: 'suggested',
          score: 0.3,
          distance: 2,
          fanIn: 2,
        },
      ],
    } as unknown as ScanJsonOutput;
    const metrics = measureSymbolMapping(scanWithCandidates, symbolTruth);
    expect(metrics.pending).toBe(false);
    // The class method is qualified through its CONTAINS member edge.
    expect(metrics.candidates).toEqual(['AuthService.login', 'logger']);
    expect(metrics.truePositives).toEqual(['AuthService.login']);
    expect(metrics.falsePositives).toEqual(['logger']);
    expect(metrics.precision).toBeCloseTo(1 / 2);
    expect(metrics.recall).toBeCloseTo(1 / 2);
  });
});

describe('mapping-quality fixtures (current-engine regression baseline)', () => {
  async function measure(name: string): Promise<{ scan: ScanJsonOutput; metrics: MappingMetrics }> {
    const root = fixtureRoot(name);
    const scan = await runScan(root, { dbPath: tempDbPath() });
    return { scan, metrics: measureFileMapping(scan, loadGroundTruth(root)) };
  }

  it('01-simple-login: full recall, shared infrastructure pollutes precision', async () => {
    const { scan, metrics } = await measure('01-simple-login');

    expect(metrics.featureId).toBe('feature:login');
    expect(scan.features.some((f) => f.id === 'feature:login')).toBe(true);

    // The whole call chain from the endpoint is reachable via IMPORTS.
    expect(metrics.recall).toBe(1);
    expect(metrics.falseNegatives).toEqual([]);

    // Known current-engine gap: shared infrastructure pulled into the
    // closure becomes a false positive (acceptance §1 Blocker).
    expect(metrics.falsePositives).toEqual(
      expect.arrayContaining(['src/shared/logger.ts', 'src/shared/http-client.ts']),
    );
    expect(metrics.precision).toBeLessThan(1);

    // Symbol level (Milestone 7 engine): the whole call chain is found.
    const symbolMetrics = measureSymbolMapping(scan, loadGroundTruth(fixtureRoot('01-simple-login')));
    expect(symbolMetrics.pending).toBe(false);
    expect(symbolMetrics.truePositives).toEqual(
      expect.arrayContaining(['loginHandler', 'login', 'AuthService.login', 'UserRepository.findByEmail']),
    );
    expect(symbolMetrics.recall).toBe(1);
  });

  it('02-react-login: API chain found, UI component tree unreachable at file level', async () => {
    const { scan, metrics } = await measure('02-react-login');

    expect(metrics.featureId).toBe('feature:login');

    // Known current-engine gap: nothing links the API chain to the
    // React tree at file level (recall gap that discovery-side
    // component traversal could close later).
    expect(metrics.falseNegatives).toEqual(
      expect.arrayContaining([
        'src/login/LoginPage.tsx',
        'src/login/LoginForm.tsx',
        'src/login/useLogin.ts',
      ]),
    );
    expect(metrics.recall).toBeLessThan(1);

    // Shared logger imported by the service chain pollutes precision.
    expect(metrics.falsePositives).toContain('src/shared/logger.ts');
    expect(metrics.precision).toBeLessThan(1);

    // Symbol level (Milestone 7 engine): the declared file anchor
    // reaches the component tree, so symbol-level recall is complete.
    const symbolMetrics = measureSymbolMapping(scan, loadGroundTruth(fixtureRoot('02-react-login')));
    expect(symbolMetrics.pending).toBe(false);
    expect(symbolMetrics.recall).toBe(1);
    expect(symbolMetrics.truePositives).toEqual(
      expect.arrayContaining([
        'LoginPage',
        'LoginForm',
        'useLogin',
        'login',
        'AuthService.authenticate',
        'UserRepository.findByEmail',
      ]),
    );
    // Shared UI primitives surface as suggestions, never as owns.
    const byId = new Map(scan.candidates.map((c) => [c.targetId, c]));
    expect(byId.get('src/components/Button.tsx:Button')).toMatchObject({ relation: 'DEPENDS_ON' });
  });

  it('03-nextjs-auth: relative chain resolves, tsconfig path aliases do not', async () => {
    const { scan, metrics } = await measure('03-nextjs-auth');

    expect(metrics.featureId).toBe('feature:login');

    // Only the relative-import chain from the custom server resolves.
    expect(metrics.candidates).toEqual(
      expect.arrayContaining(['src/server.ts', 'src/app/api/login/route.ts']),
    );

    // Known current-engine gap: `@/*` aliases are unresolved
    // (acceptance §1 Blocker "tsconfig paths can be resolved").
    expect(metrics.falseNegatives).toEqual(
      expect.arrayContaining([
        'src/lib/auth.ts',
        'src/services/auth.ts',
        'src/repositories/user.ts',
        'src/app/login/page.tsx',
      ]),
    );
    expect(metrics.recall).toBeLessThan(1);
    expect(metrics.precision).toBe(1); // the two resolved files are both expected

    // Symbol level: same alias gap — only the server-side chain and
    // the anchored page itself are candidates.
    const symbolMetrics = measureSymbolMapping(scan, loadGroundTruth(fixtureRoot('03-nextjs-auth')));
    expect(symbolMetrics.pending).toBe(false);
    expect(symbolMetrics.truePositives).toEqual(
      expect.arrayContaining(['loginRoute', 'LoginPage']),
    );
    expect(symbolMetrics.falseNegatives).toEqual(
      expect.arrayContaining(['login', 'AuthService.login', 'UserRepository.findByEmail', 'LoginForm']),
    );
  });
});
