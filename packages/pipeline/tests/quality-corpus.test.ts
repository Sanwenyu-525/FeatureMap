/**
 * Stage 1 corpus tests (v0.7.1, Milestone 26 §Stage 1) — every fixture's
 * `mapping.expected.json` must load, validate, reference real files, and
 * meet the curated-slice volume (≥30 expected, ≥20 hard negatives).
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMappingBenchmark } from '../src/quality/load.js';
import { resolveTarget } from '../src/quality/resolve.js';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
);

const FIXTURES = ['01-simple-login', '02-react-login', '03-nextjs-auth', '04-shared-utils', '05-monorepo', '06-cross-feature'];

describe('Golden corpus — fixtures 01–06', () => {
  it('every fixture has a loadable, valid mapping.expected.json', () => {
    for (const fx of FIXTURES) {
      const spec = loadMappingBenchmark(join(fixturesDir, fx));
      expect(spec.version).toBe(1);
      expect(spec.features.length).toBeGreaterThan(0);
    }
  });

  it('every file target references a real file in its fixture', () => {
    for (const fx of FIXTURES) {
      const spec = loadMappingBenchmark(join(fixturesDir, fx));
      const targets = [
        ...spec.features.flatMap((f) => [...f.expected, ...(f.notExpected ?? [])]),
        ...(spec.entities ?? []),
      ].map((m) => m.target);
      for (const t of targets) {
        expect(existsSync(join(fixturesDir, fx, resolveTarget(t).path)), `${fx}: ${t.path}`).toBe(true);
      }
    }
  });

  it('meets the curated-slice volume (≥30 expected, ≥20 hard negatives)', () => {
    let expected = 0;
    let notExpected = 0;
    let features = 0;
    for (const fx of FIXTURES) {
      const spec = loadMappingBenchmark(join(fixturesDir, fx));
      features += spec.features.length;
      for (const f of spec.features) {
        expected += f.expected.length;
        notExpected += (f.notExpected ?? []).length;
      }
    }
    expect(features).toBeGreaterThanOrEqual(6);
    expect(expected).toBeGreaterThanOrEqual(30);
    expect(notExpected).toBeGreaterThanOrEqual(20);
  });

  it('has stable targets (path + symbol name, no absolute paths)', () => {
    for (const fx of FIXTURES) {
      const spec = loadMappingBenchmark(join(fixturesDir, fx));
      for (const f of spec.features) {
        for (const m of [...f.expected, ...(f.notExpected ?? [])]) {
          expect(m.target.path.startsWith('/')).toBe(false);
          if (m.target.type === 'symbol') expect(m.target.symbol?.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
