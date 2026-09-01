/**
 * Code graph inspection tests (docs/DEVELOPMENT_PLAN.md Milestone 6).
 *
 * inspectFile must surface exactly the evidence-backed neighborhood of
 * a file — no inference beyond stored evidence rows.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, schema } from '@featuremap/db';
import type { FeatureMapDatabase } from '@featuremap/db';
import { inspectFile } from '../src/graph.js';

let dbPath: string;
let db: FeatureMapDatabase;

const ROWS = [
  {
    id: 'e1',
    sourceType: 'file',
    sourceId: 'src/a.js',
    relationType: 'IMPORTS',
    targetType: 'file',
    targetId: 'src/b.js',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
  },
  {
    id: 'e2',
    sourceType: 'file',
    sourceId: 'src/b.js',
    relationType: 'IMPORTS',
    targetType: 'file',
    targetId: 'src/a.js',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
  },
  {
    id: 'e3',
    sourceType: 'file',
    sourceId: 'src/a.js',
    relationType: 'CONTAINS',
    targetType: 'symbol',
    targetId: 'symbol:src/a.js:foo',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
    metadata: { kind: 'function' },
  },
  {
    id: 'e4',
    sourceType: 'file',
    sourceId: 'src/a.js',
    relationType: 'REFERENCES',
    targetType: 'symbol',
    targetId: 'symbol:src/a.js:foo',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
    metadata: { kind: 'function' },
  },
  {
    id: 'e5',
    sourceType: 'symbol',
    sourceId: 'symbol:src/a.js:foo',
    relationType: 'CALLS',
    targetType: 'symbol',
    targetId: 'symbol:src/b.js:bar',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
  },
  {
    id: 'e6',
    sourceType: 'symbol',
    sourceId: 'symbol:src/c.js:main',
    relationType: 'CALLS',
    targetType: 'symbol',
    targetId: 'symbol:src/a.js:foo',
    confidence: 0.9,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
  },
  {
    id: 'e7',
    sourceType: 'symbol',
    sourceId: 'symbol:src/a.js:Page',
    relationType: 'REFERENCES',
    targetType: 'symbol',
    targetId: 'symbol:src/b.js:Widget',
    confidence: 1.0,
    analyzerId: 'typescript',
    origin: 'deterministic' as const,
    metadata: { usage: 'component' },
  },
];

beforeAll(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'featuremap-graph-')), 'test.db');
  const opened = openDatabase(dbPath);
  db = opened.db;
  for (const row of ROWS) {
    db.insert(schema.evidence).values(row).run();
  }
});

describe('inspectFile', () => {
  it('reports the evidence-backed neighborhood of a file', () => {
    const result = inspectFile('/repo', 'src/a.js', dbPath);
    expect(result.imports).toEqual(['src/b.js']);
    expect(result.importedBy).toEqual(['src/b.js']);
    expect(result.contains).toEqual([
      { symbolId: 'symbol:src/a.js:foo', kind: 'function' },
    ]);
    expect(result.exports).toEqual(['symbol:src/a.js:foo']);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      sourceId: 'symbol:src/a.js:foo',
      targetId: 'symbol:src/b.js:bar',
      confidence: 1.0,
    });
    expect(result.calledBy).toHaveLength(1);
    expect(result.calledBy[0]).toMatchObject({
      sourceId: 'symbol:src/c.js:main',
      confidence: 0.9,
    });
    expect(result.componentUsage).toEqual([
      expect.objectContaining({
        sourceId: 'symbol:src/a.js:Page',
        targetId: 'symbol:src/b.js:Widget',
        usage: 'component',
      }),
    ]);
  });
});
