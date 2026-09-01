import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, openMemoryDatabase, schema } from '../src/index.js';

afterAll(() => {
  rmSync(join(tmpdir(), 'featuremap-db-test'), { recursive: true, force: true });
});

describe('schema (docs/DATA_MODEL.md §6)', () => {
  it('persists a project, feature and evidence relation end-to-end', () => {
    const { db } = openMemoryDatabase();

    db.insert(schema.projects)
      .values({ id: 'p1', name: 'demo', root: '/repo', baseBranch: 'main' })
      .run();

    db.insert(schema.features)
      .values({
        id: 'f1',
        name: 'User Login',
        pattern: 'Authentication',
        confidence: 0.94,
        status: 'active',
      })
      .run();

    db.insert(schema.evidence)
      .values({
        id: 'e1',
        sourceType: 'endpoint',
        sourceId: 'POST /api/auth/login',
        relationType: 'HANDLED_BY',
        targetType: 'symbol',
        targetId: 'AuthController.login',
        confidence: 1.0,
        analyzerId: 'nestjs@0.0.1',
        origin: 'deterministic',
      })
      .run();

    const rows = db.select().from(schema.evidence).where(eq(schema.evidence.id, 'e1')).all();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.relationType).toBe('HANDLED_BY');
    expect(row?.confidence).toBe(1.0);
    expect(row?.origin).toBe('deterministic');
  });

  it('keeps manual overrides alongside analyzer evidence (docs/DATA_MODEL.md §7)', () => {
    const { db } = openMemoryDatabase();
    db.insert(schema.manualOverrides)
      .values({
        id: 'o1',
        action: 'rename_feature',
        payload: { featureId: 'f1', name: 'Authentication Flow' },
      })
      .run();
    const rows = db.select().from(schema.manualOverrides).all();
    expect(rows).toHaveLength(1);
  });

  it('opens and creates a file-backed store in the runtime directory', () => {
    const dbPath = join(tmpdir(), 'featuremap-db-test', 'nested', 'featuremap.db');
    const { db, sqlite } = openDatabase(dbPath);
    try {
      db.insert(schema.projects)
        .values({ id: 'p2', name: 'file-backed', root: '/other' })
        .run();
      const rows = db.select().from(schema.projects).all();
      expect(rows).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });
});
