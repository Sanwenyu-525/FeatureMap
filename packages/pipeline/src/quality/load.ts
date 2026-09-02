/**
 * Load + validate a fixture's `mapping.expected.json` (v0.7.1 §Stage 0).
 * Validation is strict so corpus errors surface at load time, never as a
 * silent metric skew. Paths are defensively checked (no absolute path,
 * no `..`) — ground truth is relative to the fixture root.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAPPING_BENCHMARK_VERSION,
  type BenchmarkFeature,
  type BenchmarkRelation,
  type BenchmarkTarget,
  type ConfidenceClass,
  type ExpectedMapping,
  type MappingBenchmarkSpec,
} from './types.js';

export const BENCHMARK_FILE = 'mapping.expected.json';

const RELATIONS: BenchmarkRelation[] = ['OWNS', 'DEPENDS_ON'];
const CONFIDENCE_CLASSES: ConfidenceClass[] = ['must-high', 'may-suggest', 'must-not-high'];

export class BenchmarkSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkSpecError';
  }
}

function assertTarget(target: unknown, where: string): asserts target is BenchmarkTarget {
  const t = target as Partial<BenchmarkTarget> | null;
  if (!t || typeof t !== 'object') throw new BenchmarkSpecError(`${where}: target is required`);
  if (t.type !== 'file' && t.type !== 'symbol') throw new BenchmarkSpecError(`${where}: target.type must be "file" | "symbol"`);
  if (typeof t.path !== 'string' || t.path === '') throw new BenchmarkSpecError(`${where}: target.path is required`);
  if (t.path.startsWith('/') || t.path.includes('..')) {
    throw new BenchmarkSpecError(`${where}: target.path must be relative (${t.path})`);
  }
  if (t.type === 'symbol' && (typeof t.symbol !== 'string' || t.symbol === '')) {
    throw new BenchmarkSpecError(`${where}: symbol target requires target.symbol`);
  }
}

function assertMapping(value: unknown, where: string): ExpectedMapping {
  const m = value as Partial<ExpectedMapping> | null;
  if (!m || typeof m !== 'object') throw new BenchmarkSpecError(`${where}: expected/notExpected entries must be objects`);
  assertTarget(m.target, where);
  if (!RELATIONS.includes(m.relation as BenchmarkRelation)) {
    throw new BenchmarkSpecError(`${where}: relation must be "OWNS" | "DEPENDS_ON"`);
  }
  if (m.confidenceClass !== undefined && !CONFIDENCE_CLASSES.includes(m.confidenceClass as ConfidenceClass)) {
    throw new BenchmarkSpecError(`${where}: confidenceClass must be must-high | may-suggest | must-not-high`);
  }
  if (m.tags !== undefined && !Array.isArray(m.tags)) throw new BenchmarkSpecError(`${where}: tags must be an array`);
  return m as ExpectedMapping;
}

function assertFeature(value: unknown, where: string): BenchmarkFeature {
  const f = value as Partial<BenchmarkFeature> | null;
  if (!f || typeof f !== 'object') throw new BenchmarkSpecError(`${where}: feature is required`);
  if (typeof f.id !== 'string' || f.id === '') throw new BenchmarkSpecError(`${where}: feature.id is required`);
  if (!Array.isArray(f.expected)) throw new BenchmarkSpecError(`${where} (${f.id}): expected is required`);
  const expected = f.expected.map((m, i) => assertMapping(m, `${where} (${f.id}).expected[${i}]`));
  const notExpected = (f.notExpected ?? []).map((m, i) => assertMapping(m, `${where} (${f.id}).notExpected[${i}]`));
  return { id: f.id, name: typeof f.name === 'string' ? f.name : undefined, expected, notExpected };
}

export function loadMappingBenchmark(
  fixtureRoot: string,
  fileName = BENCHMARK_FILE,
): MappingBenchmarkSpec {
  const path = join(fixtureRoot, fileName);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new BenchmarkSpecError(`${path}: missing (create ${BENCHMARK_FILE})`);
  }
  return parseMappingBenchmark(raw, path);
}

export function parseMappingBenchmark(raw: string, source = 'mapping.expected.json'): MappingBenchmarkSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new BenchmarkSpecError(`${source}: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  const spec = parsed as Partial<MappingBenchmarkSpec> | null;
  if (!spec || typeof spec !== 'object') throw new BenchmarkSpecError(`${source}: spec must be an object`);
  if (spec.version !== MAPPING_BENCHMARK_VERSION) {
    throw new BenchmarkSpecError(`${source}: version must be ${MAPPING_BENCHMARK_VERSION}`);
  }
  if (!Array.isArray(spec.features) || spec.features.length === 0) {
    throw new BenchmarkSpecError(`${source}: features is required and non-empty`);
  }
  const features = spec.features.map((f, i) => assertFeature(f, `${source}.features[${i}]`));
  const entities = (spec.entities ?? []).map((e, i) => {
    assertTarget((e as { target?: unknown }).target, `${source}.entities[${i}]`);
    const tags = (e as { tags?: unknown }).tags;
    if (!Array.isArray(tags)) throw new BenchmarkSpecError(`${source}.entities[${i}]: tags is required`);
    return e as { target: BenchmarkTarget; tags: string[] };
  });
  return { version: MAPPING_BENCHMARK_VERSION, features, entities };
}
