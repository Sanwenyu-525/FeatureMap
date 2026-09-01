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

  it('03-nextjs-auth: tsconfig path aliases resolve end to end', async () => {
    const { scan, metrics } = await measure('03-nextjs-auth');

    expect(metrics.featureId).toBe('feature:login');

    // Acceptance §1 Blocker: `@/*` aliases resolve. The file-level
    // discovery engine reaches the whole API chain through aliases
    // (route → lib/auth → services/auth → repositories/user).
    expect(metrics.candidates).toEqual(
      expect.arrayContaining([
        'src/lib/auth.ts',
        'src/services/auth.ts',
        'src/repositories/user.ts',
      ]),
    );
    // File-level recall stays partial: the discovery engine has no file
    // anchors, so the UI-side files remain unreachable (same gap as
    // fixture 02). The candidate engine below closes it at symbol level.
    expect(metrics.falseNegatives).toEqual(
      expect.arrayContaining([
        'src/app/login/page.tsx',
        'src/app/login/LoginForm.tsx',
        'src/hooks/useLogin.ts',
      ]),
    );
    expect(metrics.recall).toBeLessThan(1);

    // Shared infra imported through aliases is still down-weighted as
    // a dependency, never ownership: it stays out of the expected set.
    // (Button is a UI-side file the discovery engine never reaches; it
    // appears among symbol-level candidates instead — see below.)
    expect(metrics.falsePositives).toEqual(['src/lib/logger.ts']);

    // Symbol level: the whole alias chain resolves, including methods.
    const symbolMetrics = measureSymbolMapping(scan, loadGroundTruth(fixtureRoot('03-nextjs-auth')));
    expect(symbolMetrics.pending).toBe(false);
    expect(symbolMetrics.truePositives).toEqual(
      expect.arrayContaining([
        'loginRoute',
        'login',
        'AuthService.login',
        'UserRepository.findByEmail',
        'LoginPage',
        'LoginForm',
        'useLogin',
      ]),
    );
    expect(symbolMetrics.recall).toBe(1);
  });

  it('05-monorepo: cross-package chain resolves, workspaces do not collide', async () => {
    const root = fixtureRoot('05-monorepo');
    const scan = await runScan(root, { dbPath: tempDbPath() });
    const metrics = measureFileMapping(scan, loadGroundTruth(root));

    expect(metrics.featureId).toBe('feature:login');

    // The @company/auth/* alias reaches into the real package sources.
    expect(metrics.candidates).toEqual(
      expect.arrayContaining([
        'packages/auth/src/login.ts',
        'packages/auth/src/auth-service.ts',
        'packages/auth/src/user-repository.ts',
      ]),
    );

    // Workspace identity: neither same-named utils.ts is imported, so
    // neither appears — and they never collide with each other.
    expect(metrics.candidates.some((c) => c.endsWith('/utils.ts'))).toBe(false);

    // The endpoint chain is fully reachable: no false negatives.
    expect(metrics.falseNegatives).toEqual([]);
    expect(metrics.recall).toBe(1);

    // Symbol level reaches the anchored page and the package methods.
    const symbolMetrics = measureSymbolMapping(scan, loadGroundTruth(root));
    expect(symbolMetrics.truePositives).toEqual(
      expect.arrayContaining([
        'loginHandler',
        'login',
        'AuthService.login',
        'UserRepository.findByEmail',
        'LoginPage',
      ]),
    );
    expect(symbolMetrics.recall).toBe(1);
  });

  it('06-cross-feature: shared boundary file separates by symbol', async () => {
    const root = fixtureRoot('06-cross-feature');
    const scan = await runScan(root, { dbPath: tempDbPath() });
    const loginTruth = loadGroundTruth(root);
    const logoutTruth = loadGroundTruth(root, 'ground-truth.logout.yaml');

    const loginMetrics = measureFileMapping(scan, loginTruth);
    const logoutMetrics = measureFileMapping(scan, logoutTruth);
    expect(loginMetrics.featureId).toBe('feature:login');
    expect(logoutMetrics.featureId).toBe('feature:logout');

    // File-level closure pulls the shared boundary file and repository
    // into both features (the documented file-granularity limit), but
    // the OTHER feature's handler and entry file never leak across.
    expect(loginMetrics.truePositives).toContain('src/auth/session-service.ts');
    expect(loginMetrics.falsePositives).not.toContain('src/api/logout-handler.ts');
    expect(loginMetrics.falsePositives).not.toContain('src/auth/logout.ts');
    expect(logoutMetrics.truePositives).toContain('src/auth/session-service.ts');
    expect(logoutMetrics.falsePositives).not.toContain('src/api/login-handler.ts');

    // Symbol level: each feature owns its half of the boundary file.
    const loginSymbols = measureSymbolMapping(scan, loginTruth);
    expect(loginSymbols.truePositives).toEqual(
      expect.arrayContaining(['loginHandler', 'login', 'SessionService.create']),
    );
    expect(loginSymbols.falsePositives).not.toContain('SessionService.destroy');
    expect(loginSymbols.falsePositives).not.toContain('logout');

    const logoutSymbols = measureSymbolMapping(scan, logoutTruth);
    expect(logoutSymbols.truePositives).toEqual(
      expect.arrayContaining(['logoutHandler', 'logout', 'SessionService.destroy']),
    );
    expect(logoutSymbols.falsePositives).not.toContain('SessionService.create');
    expect(logoutSymbols.falsePositives).not.toContain('login');
  });

  it('04-shared-utils: shared infrastructure is down-weighted, never ownership', async () => {
    const root = fixtureRoot('04-shared-utils');
    const scan = await runScan(root, { dbPath: tempDbPath() });
    const billingTruth = loadGroundTruth(root);
    const notificationTruth = loadGroundTruth(root, 'ground-truth.notification.yaml');

    const byId = new Map(
      scan.candidates.map((c) => [`${c.featureId}|${c.targetId}`, c]),
    );
    const sharedFiles = ['src/shared/logger.ts', 'src/shared/config.ts', 'src/shared/http-client.ts'];

    for (const featureId of ['feature:billing', 'feature:notification']) {
      // Blocker: shared infrastructure never surfaces as ownership.
      for (const shared of sharedFiles) {
        const fileCandidate = byId.get(`${featureId}|${shared}`);
        expect(fileCandidate?.relation).toBe('DEPENDS_ON');
        // The config/http-client imports are only 2 features deep, so the
        // soft cap does not bind (documented calibration item); the
        // highest-fan-in file (logger, 6 importers) must drop below 50%.
        if (shared === 'src/shared/logger.ts') {
          expect(fileCandidate?.score ?? 1).toBeLessThan(0.5);
        }
      }

      // Cross-feature isolation: the other feature's code never appears.
      const other =
        featureId === 'feature:billing'
          ? ['src/notification/notification-handler.ts', 'src/notification/notification.ts']
          : ['src/billing/billing-handler.ts', 'src/billing/billing.ts'];
      for (const leak of other) {
        expect(byId.has(`${featureId}|${leak}`)).toBe(false);
      }
      // The composition hub is never pulled in from below.
      expect(byId.has(`${featureId}|src/server.ts`)).toBe(false);
    }

    // Granularity rule: file-level P/R measures the endpoint-anchored
    // discovery engine (fixture 02 note); fixture 04 declares file
    // anchors and has no endpoints, so the file engine yields nothing
    // and the candidate engine below is the acceptance target.
    const billingFiles = measureFileMapping(scan, billingTruth);
    expect(billingFiles.candidates).toEqual([]);
    const notificationFiles = measureFileMapping(scan, notificationTruth);
    expect(notificationFiles.candidates).toEqual([]);

    // Symbol level: own chains complete; the only shared symbols that
    // surface are the ones actually called (log, HttpClient.post) — as
    // DEPENDS_ON candidates, the reject-flow target population.
    const billingSymbols = measureSymbolMapping(scan, billingTruth);
    expect(billingSymbols.pending).toBe(false);
    expect(billingSymbols.truePositives).toEqual(
      expect.arrayContaining([
        'billingHandler',
        'Billing.run',
        'InvoiceService.createInvoice',
        'InvoiceRepository.save',
      ]),
    );
    expect(billingSymbols.recall).toBe(1);
    expect(billingSymbols.falsePositives).toEqual(
      expect.arrayContaining(['log', 'HttpClient.post']),
    );
    const notificationSymbols = measureSymbolMapping(scan, notificationTruth);
    expect(notificationSymbols.truePositives).toEqual(
      expect.arrayContaining([
        'notificationHandler',
        'Notification.dispatch',
        'NotificationService.send',
        'NotificationRepository.record',
      ]),
    );
    expect(notificationSymbols.recall).toBe(1);
  });
});
