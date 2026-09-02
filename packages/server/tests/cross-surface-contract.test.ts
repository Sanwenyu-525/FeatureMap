/**
 * Cross-surface contract CI (v0.7.0, Milestone 25 §Stage 3).
 *
 * The risk the plan targets: four surfaces (CLI / MCP / IDE / HTTP)
 * slowly speaking four different languages. This test drives every
 * surface against ONE scanned fixture and asserts each returns the
 * exact same canonical `FeatureContextDocument` — featureId, task,
 * sections, recommendedFiles, budget, artifact and markdown — plus the
 * location (1-based) and read-only invariants, so a divergence in any
 * adapter is caught here.
 *
 * Surfaces under test:
 *   HTTP   buildServer().inject(POST /api/context)
 *   IDE    createIdeService().handlers['context.build']
 *   MCP    getFeatureContext(...).document  (same envelope, same doc)
 *   CLI    buildFeatureContextDocument      (the CLI command's code path;
 *          the CLI prints its `.markdown` verbatim — Milestone 24 §Stage 1)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runScan } from '@featuremap/pipeline';
import { openDatabase, schema } from '@featuremap/db';
import { buildFeatureContextDocument, type FeatureContextDocument } from '@featuremap/context';
import { createIdeService } from '@featuremap/ide';
import { getFeatureContext, type ToolContext } from '@featuremap/mcp';
import { buildServer } from '../src/app.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

let tempDir: string;
let dbPath: string;
let httpServer: ReturnType<typeof buildServer>;
let ideService: ReturnType<typeof createIdeService>;
let mcpCtx: ToolContext;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'featuremap-xsurface-'));
  dbPath = join(tempDir, 'featuremap.db');
  await runScan(fixtureRoot, { dbPath });
  httpServer = buildServer({ repoRoot: fixtureRoot, dbPath });
  ideService = createIdeService({ repoRoot: fixtureRoot, dbPath });
  mcpCtx = { repoRoot: fixtureRoot, dbPath };
});

afterAll(async () => {
  await httpServer.close();
  ideService.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Every surface must equal this reference document. */
function reference(task?: string): FeatureContextDocument {
  return buildFeatureContextDocument(fixtureRoot, 'feature:login', { dbPath, task });
}

function allEntries(doc: FeatureContextDocument): FeatureContextDocument['sections']['core'] {
  return [...doc.sections.core, ...doc.sections.dependencies, ...doc.sections.tests];
}

function evidenceCount(): number {
  const { db, sqlite } = openDatabase(dbPath);
  try {
    return db.select().from(schema.evidence).all().length;
  } finally {
    sqlite.close();
  }
}

describe('Cross-surface contract — the four surfaces speak one document', () => {
  it('HTTP POST /api/context equals the canonical reference', async () => {
    const res = await httpServer.inject({
      method: 'POST',
      url: '/api/context',
      payload: { featureId: 'feature:login' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual(reference());
  });

  it('IDE context.build RPC equals the canonical reference', () => {
    const doc = ideService.handlers['context.build']({ featureId: 'feature:login' });
    expect(doc).toEqual(reference());
  });

  it('MCP get_feature_context exposes the same canonical document', async () => {
    const result = (await getFeatureContext(mcpCtx, { featureId: 'feature:login' })) as {
      document: FeatureContextDocument;
    };
    expect(result.document).toEqual(reference());
  });

  it('CLI context markdown survives the HTTP JSON round-trip unchanged', async () => {
    const res = await httpServer.inject({
      method: 'POST',
      url: '/api/context',
      payload: { featureId: 'feature:login' },
    });
    const httpDoc = res.json() as FeatureContextDocument;
    // The CLI command prints buildFeatureContextDocument(...).markdown
    // verbatim; a JSON round-trip through the HTTP adapter must not
    // rewrite a single byte of the canonical markdown.
    expect(buildFeatureContextDocument(fixtureRoot, 'feature:login', { dbPath }).markdown).toBe(httpDoc.markdown);
    expect(httpDoc.markdown).toContain('## Recommended Files');
  });

  it('task-aware builds match across surfaces and never mutate the graph', async () => {
    const before = evidenceCount();
    const http = await httpServer.inject({
      method: 'POST',
      url: '/api/context',
      payload: { featureId: 'feature:login', task: 'refresh token rotation' },
    });
    const httpDoc = http.json() as FeatureContextDocument;
    const ideDoc = ideService.handlers['context.build']({
      featureId: 'feature:login',
      task: 'refresh token rotation',
    }) as FeatureContextDocument;
    const mcpResult = (await getFeatureContext(mcpCtx, {
      featureId: 'feature:login',
      task: 'refresh token rotation',
    })) as { document: FeatureContextDocument };
    const taskRef = reference('refresh token rotation');
    expect(httpDoc).toEqual(taskRef);
    expect(ideDoc).toEqual(taskRef);
    expect(mcpResult.document).toEqual(taskRef);
    expect(httpDoc.markdown).toContain('## Task');
    expect(evidenceCount()).toBe(before); // read-only invariant
  });

  it('1-based line convention holds across every surface', () => {
    const surfaces = [
      reference(),
      ideService.handlers['context.build']({ featureId: 'feature:login' }),
    ];
    for (const doc of surfaces) {
      for (const e of allEntries(doc)) {
        if (e.symbol?.startLine !== undefined) expect(e.symbol.startLine).toBeGreaterThanOrEqual(1);
        if (e.symbol?.endLine !== undefined) expect(e.symbol.endLine).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
