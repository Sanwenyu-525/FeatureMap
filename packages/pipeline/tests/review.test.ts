/**
 * Review workflow tests — Milestone 8 (docs/DEVELOPMENT_PLAN.md),
 * ADR-0003 §4 and docs/releases/v0.2-acceptance.md §1/§4.
 *
 * Pinned behavior:
 * - accept/reject verdicts persist across rescans (Blocker item)
 * - a rejected shared utility never reappears as a suggestion
 * - a changed evidence fingerprint supersedes the verdict (drift)
 * - explain renders the full evidence chain behind a score
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  explainCandidate,
  listCandidates,
  ReviewError,
  runScan,
  setVerdict,
} from '../src/index.js';

const FIXTURES_ROOT = fileURLToPath(new URL('../../../test-fixtures', import.meta.url));
const tempDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'featuremap-review-'));
  tempDirs.push(dir);
  return join(dir, 'featuremap.db');
}

/** Shared store for the fixture-01 scenario, created on first use. */
let sharedDir: string | undefined;
function fixtureDb(): string {
  if (sharedDir === undefined) {
    sharedDir = mkdtempSync(join(tmpdir(), 'featuremap-review-'));
    tempDirs.push(sharedDir);
  }
  return join(sharedDir, 'featuremap.db');
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function scanFixture01(): Promise<void> {
  await runScan(join(FIXTURES_ROOT, '01-simple-login'), { dbPath: fixtureDb() });
}

describe('review workflow on fixture 01', () => {
  it('accept and reject verdicts persist across rescans', async () => {
    await scanFixture01();

    const accepted = setVerdict(
      join(FIXTURES_ROOT, '01-simple-login'),
      'login',
      'src/auth/auth-service.ts:login',
      'accepted',
      fixtureDb(),
    );
    expect(accepted.status).toBe('accepted');

    const rejected = setVerdict(
      join(FIXTURES_ROOT, '01-simple-login'),
      'login',
      'src/shared/logger.ts',
      'rejected',
      fixtureDb(),
    );
    expect(rejected.status).toBe('rejected');

    // Rescan: verdicts survive, never reset to suggested.
    await runScan(join(FIXTURES_ROOT, '01-simple-login'), { dbPath: fixtureDb() });
    const after = listCandidates(join(FIXTURES_ROOT, '01-simple-login'), 'login', fixtureDb());
    const byId = new Map(after.map((c) => [c.targetId, c]));
    expect(byId.get('src/auth/auth-service.ts:login')?.status).toBe('accepted');
    expect(byId.get('src/shared/logger.ts')?.status).toBe('rejected');
  });

  it('a rejected shared utility never reappears as a suggestion', async () => {
    // Continuing the previous state: logger is rejected; rescan again.
    await runScan(join(FIXTURES_ROOT, '01-simple-login'), { dbPath: fixtureDb() });
    const candidates = listCandidates(join(FIXTURES_ROOT, '01-simple-login'), 'login', fixtureDb());
    const logger = candidates.find((c) => c.targetId === 'src/shared/logger.ts');
    expect(logger?.status).toBe('rejected');
    // The candidate remains known — but not as an active suggestion.
    expect(candidates.some((c) => c.targetId === 'src/shared/logger.ts' && c.status === 'suggested')).toBe(false);
  });

  it('explain renders the full evidence chain behind the score', () => {
    const explained = explainCandidate(
      join(FIXTURES_ROOT, '01-simple-login'),
      'login',
      'findByEmail', // unique bare-name match
      fixtureDb(),
    );
    expect(explained.featureId).toBe('feature:login');
    expect(explained.targetId).toBe('src/auth/user-repository.ts:findByEmail');
    expect(explained.distance).toBeGreaterThan(0);
    expect(explained.chain.length).toBe(explained.distance + 1);
    // Chain starts at the (nearest) anchor and ends at the target.
    expect(explained.chain[0]?.sourceId).toBe('src/auth/login.ts');
    expect(explained.chain.at(-1)?.targetId).toBe('src/auth/user-repository.ts:findByEmail');
  });

  it('explain resolves qualified Class.member names through CONTAINS evidence (acceptance §5)', () => {
    const explained = explainCandidate(
      join(FIXTURES_ROOT, '01-simple-login'),
      'login',
      'UserRepository.findByEmail', // qualified name, acceptance §5 step 6
      fixtureDb(),
    );
    expect(explained.targetId).toBe('src/auth/user-repository.ts:findByEmail');
    expect(explained.targetType).toBe('symbol');
    expect(explained.chain.length).toBeGreaterThan(0);
  });

  it('rejecting declared anchors and unknown targets fails clearly', () => {
    expect(() =>
      setVerdict(join(FIXTURES_ROOT, '01-simple-login'), 'login', 'src/server.ts', 'rejected', fixtureDb()),
    ).toThrowError(ReviewError);
    expect(() =>
      setVerdict(join(FIXTURES_ROOT, '01-simple-login'), 'login', 'src/does-not-exist.ts', 'rejected', fixtureDb()),
    ).toThrowError(/No candidate/);
    expect(() =>
      setVerdict(join(FIXTURES_ROOT, '01-simple-login'), 'no-such-feature', 'x', 'accepted', fixtureDb()),
    ).toThrowError(/does not exist/);
  });

  it('a changed evidence fingerprint supersedes the verdict (drift)', async () => {
    // Fresh store.
    const dbPath = tempDb();
    const root = join(FIXTURES_ROOT, '01-simple-login');
    await runScan(root, { dbPath });
    setVerdict(root, 'login', 'src/shared/logger.ts', 'rejected', dbPath);

    // Simulate code change: drop the logger import from auth-service so
    // the rejected file's evidence chain changes shape.
    const authServicePath = join(root, 'src/auth/auth-service.ts');
    const original = readFileSync(authServicePath, 'utf8');
    try {
      writeFileSync(
        authServicePath,
        original.replace("import { logger } from '../shared/logger';\n", '').replace("    logger.info('login attempt');\n", ''),
        'utf8',
      );
      await runScan(root, { dbPath });

      const candidates = listCandidates(root, 'login', dbPath);
      const loggerFile = candidates.find((c) => c.targetId === 'src/shared/logger.ts');
      // The rejected row is gone from derivation AND its chain vanished,
      // so it is surfaced as superseded for re-review — not silently
      // suppressed forever.
      expect(loggerFile?.status).toBe('superseded');
    } finally {
      writeFileSync(authServicePath, original, 'utf8');
    }
  });
});
