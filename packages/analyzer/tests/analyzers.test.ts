/**
 * Analyzer fixture tests (docs/TESTING_STRATEGY.md §3).
 *
 * Assertions focus on emitted Evidence rather than internal
 * implementation, e.g.:
 *
 *   POST /api/login
 *   HANDLED_BY
 *   symbol:src/auth/login.js:loginHandler
 *   confidence = 1.0
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AnalyzeContext } from '@featuremap/plugin-sdk';
import {
  expressAnalyzer,
  markdownAnalyzer,
  nestjsAnalyzer,
  prismaAnalyzer,
  resolveSpecifier,
  runAnalyzers,
  typescriptAnalyzer,
} from '../src/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'test-fixtures', 'react-express-basic');

const FIXTURE_FILES = [
  'README.md',
  'package.json',
  'prisma/schema.prisma',
  'src/app.js',
  'src/auth/login.js',
  'src/auth/user.js',
];

let context: AnalyzeContext;

beforeAll(() => {
  const files = FIXTURE_FILES.map((path) => ({
    path,
    hash: 'fixture',
    size: 0,
    language: path.endsWith('.js') ? 'JavaScript' : undefined,
  }));
  context = {
    repoRoot: fixtureRoot,
    files,
    readFile: (p) => {
      try {
        return readFileSync(join(fixtureRoot, p), 'utf8');
      } catch {
        return undefined;
      }
    },
    config: {
      analyzers: ['typescript', 'express', 'prisma', 'markdown'],
      scan: { baseBranch: 'main', ignore: ['node_modules/**'] },
    },
  };
});

function evidenceOf(
  result: { relationType: string; sourceId: string; targetId: string; confidence: number }[],
) {
  return result.map((e) => `${e.sourceId} ${e.relationType} ${e.targetId} (${e.confidence})`);
}

describe('typescript analyzer', () => {
  it('extracts symbols from fixture files', async () => {
    const result = await typescriptAnalyzer.analyze(context);
    const names = result.assets.filter((a) => a.type === 'symbol').map((a) => a.name);
    expect(names).toContain('loginHandler');
    expect(names).toContain('findUserByEmail');
    expect(names).toContain('listUsers');
  });

  it('emits deterministic IMPORTS evidence resolved to repo files', async () => {
    const result = await typescriptAnalyzer.analyze(context);
    const imports = result.evidence.filter((e) => e.relationType === 'IMPORTS');
    expect(evidenceOf(imports)).toContain(
      'src/app.js IMPORTS src/auth/login.js (1)',
    );
    expect(evidenceOf(imports)).toContain(
      'src/auth/login.js IMPORTS src/auth/user.js (1)',
    );
  });
});

describe('resolveSpecifier (acceptance §1 Resolution blockers)', () => {
  const fileSet = new Set([
    'src/shared/index.ts',
    'src/shared/logger.ts',
    'src/auth/login.ts',
    'src/auth/user.js',
  ]);

  it('resolves directory imports to index files', () => {
    expect(resolveSpecifier('src/app.ts', './shared', fileSet)).toBe('src/shared/index.ts');
  });

  it('resolves extensionless and NodeNext .js spellings', () => {
    expect(resolveSpecifier('src/app.ts', './shared/logger', fileSet)).toBe('src/shared/logger.ts');
    expect(resolveSpecifier('src/app.ts', './shared/logger.js', fileSet)).toBe('src/shared/logger.ts');
  });

  it('keeps explicit extensions and rejects unresolved specifiers', () => {
    expect(resolveSpecifier('src/app.ts', './auth/user.js', fileSet)).toBe('src/auth/user.js');
    expect(resolveSpecifier('src/app.ts', './missing', fileSet)).toBeUndefined();
  });

  it('resolves tsconfig paths aliases', () => {
    expect(
      resolveSpecifier('src/app.ts', '@/shared/logger', fileSet, {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
      }),
    ).toBe('src/shared/logger.ts');
  });

  it('resolves tsconfig paths aliases written with a leading ./', () => {
    // Real-repo spelling (dify web): `"@/*": ["./*"]` with no baseUrl,
    // where `@` maps to the repository root itself.
    expect(
      resolveSpecifier('app/app.ts', '@/src/shared/logger', fileSet, {
        paths: { '@/*': ['./*'] },
      }),
    ).toBe('src/shared/logger.ts');
  });
});

describe('express analyzer', () => {
  it('emits POST /api/login with HANDLED_BY evidence at confidence 1.0', async () => {
    const result = await expressAnalyzer.analyze(context);
    const endpoints = result.assets.filter((a) => a.type === 'endpoint');
    expect(endpoints.map((e) => e.name)).toContain('POST /api/login');
    expect(endpoints.map((e) => e.name)).toContain('GET /api/users');

    const handled = result.evidence.filter((e) => e.relationType === 'HANDLED_BY');
    expect(evidenceOf(handled)).toContain(
      'endpoint:POST /api/login HANDLED_BY symbol:src/auth/login.js:loginHandler (1)',
    );
    expect(evidenceOf(handled)).toContain(
      'endpoint:GET /api/users HANDLED_BY symbol:src/app.js:listUsers (1)',
    );
  });
});

describe('prisma analyzer', () => {
  it('emits data entities and deterministic REFERENCES relations', async () => {
    const result = await prismaAnalyzer.analyze(context);
    const entities = result.assets.filter((a) => a.type === 'data_entity').map((a) => a.name);
    expect(entities).toContain('User');
    expect(entities).toContain('Post');

    const refs = result.evidence.filter((e) => e.relationType === 'REFERENCES');
    expect(evidenceOf(refs)).toContain(
      'data_entity:Post REFERENCES data_entity:User (1)',
    );
  });
});

describe('markdown analyzer', () => {
  it('links documented files with DESCRIBED_BY evidence', async () => {
    const result = await markdownAnalyzer.analyze(context);
    const described = result.evidence.filter((e) => e.relationType === 'DESCRIBED_BY');
    expect(evidenceOf(described)).toContain(
      'src/auth/login.js DESCRIBED_BY README.md (1)',
    );
    const readme = result.assets.find((a) => a.path === 'README.md');
    expect(((readme?.metadata ?? {}) as { title?: string }).title).toBe('Basic Fixture');
  });
});

describe('code graph (v0.2.0)', () => {
  it('emits deterministic CALLS evidence for named-import calls', async () => {
    const result = await typescriptAnalyzer.analyze(context);
    const calls = result.evidence.filter((e) => e.relationType === 'CALLS');
    expect(evidenceOf(calls)).toContain(
      'symbol:src/auth/login.js:loginHandler CALLS symbol:src/auth/user.js:findUserByEmail (1)',
    );
  });

  it('emits CONTAINS evidence for declared symbols', async () => {
    const result = await typescriptAnalyzer.analyze(context);
    const contains = result.evidence.filter((e) => e.relationType === 'CONTAINS');
    expect(evidenceOf(contains)).toContain(
      'src/auth/login.js CONTAINS symbol:src/auth/login.js:loginHandler (1)',
    );
    expect(evidenceOf(contains)).toContain(
      'src/auth/user.js CONTAINS symbol:src/auth/user.js:findUserByEmail (1)',
    );
  });

  it('resolves synthetic TSX call, method and component-usage edges', async () => {
    const files = {
      'src/ui/LoginPage.tsx': [
        "import { LoginForm } from './LoginForm';",
        "import { api } from './client';",
        '',
        'export function LoginPage() {',
        '  api.fetch();',
        '  return <LoginForm onSubmit={() => api.fetch()} />;',
        '}',
        '',
      ].join('\n'),
      'src/ui/LoginForm.tsx': 'export function LoginForm(props: unknown) {\n  return null;\n}\n',
      'src/ui/client.ts': 'export function fetch() {\n  return null;\n}\n',
    };
    const ctx: AnalyzeContext = {
      repoRoot: '/synthetic',
      files: Object.keys(files).map((path) => ({ path, hash: 'x', size: 0 })),
      readFile: (p) => files[p],
      config: { analyzers: ['typescript'], scan: { baseBranch: 'main', ignore: [] } },
    };
    const result = await typescriptAnalyzer.analyze(ctx);
    const calls = result.evidence.filter((e) => e.relationType === 'CALLS');
    // Property call through an imported binding: strong inference (0.9),
    // deduplicated across the direct call and the inline arrow attribute.
    expect(evidenceOf(calls)).toContain(
      'symbol:src/ui/LoginPage.tsx:LoginPage CALLS symbol:src/ui/client.ts:fetch (0.9)',
    );
    const callTargets = calls.filter(
      (e) => e.targetId === 'symbol:src/ui/client.ts:fetch',
    );
    expect(callTargets).toHaveLength(1);

    // Method call through an imported binding: strong inference (0.9).
    const methodCtx: AnalyzeContext = {
      repoRoot: '/synthetic',
      files: Object.keys(files).map((path) => ({ path, hash: 'x', size: 0 })),
      readFile: (p) =>
        p === 'src/ui/client.ts'
          ? 'export class ApiClient {\n  fetch() {\n    return null;\n  }\n}\n'
          : files[p],
      config: { analyzers: ['typescript'], scan: { baseBranch: 'main', ignore: [] } },
    };
    const methodResult = await typescriptAnalyzer.analyze(methodCtx);
    const methodCalls = methodResult.evidence.filter((e) => e.relationType === 'CALLS');
    expect(evidenceOf(methodCalls)).toContain(
      'symbol:src/ui/LoginPage.tsx:LoginPage CALLS symbol:src/ui/client.ts:fetch (0.9)',
    );

    // JSX component usage of an imported component.
    const components = result.evidence.filter(
      (e) => e.relationType === 'REFERENCES' && (e.metadata as { usage?: string }).usage === 'component',
    );
    expect(evidenceOf(components)).toContain(
      'symbol:src/ui/LoginPage.tsx:LoginPage REFERENCES symbol:src/ui/LoginForm.tsx:LoginForm (1)',
    );
  });

  it('emits class → method CONTAINS for unambiguous method names', async () => {
    const ctx: AnalyzeContext = {
      repoRoot: '/synthetic',
      files: [{ path: 'src/service.ts', hash: 'x', size: 0 }],
      readFile: () =>
        'export class AuthService {\n  start() {\n    return 1;\n  }\n}\n',
      config: { analyzers: ['typescript'], scan: { baseBranch: 'main', ignore: [] } },
    };
    const result = await typescriptAnalyzer.analyze(ctx);
    const contains = result.evidence.filter((e) => e.relationType === 'CONTAINS');
    expect(evidenceOf(contains)).toContain(
      'symbol:src/service.ts:AuthService CONTAINS symbol:src/service.ts:start (1)',
    );
  });
});

describe('platform', () => {
  it('runs all analyzers and isolates failures without aborting the scan', async () => {
    const plugins = [typescriptAnalyzer, expressAnalyzer, prismaAnalyzer, markdownAnalyzer, nestjsAnalyzer];
    const output = await runAnalyzers(plugins, context, context.files);
    // File assets are registered by the platform itself.
    expect(output.assets.filter((a) => a.type === 'file' && a.analyzerId === 'platform')).toHaveLength(
      FIXTURE_FILES.length,
    );
    // nestjs is not present in this fixture: reported as skipped, never fatal.
    const nestRun = output.runs.find((r) => r.analyzerId === 'nestjs');
    expect(nestRun?.status).toBe('skipped');
    const statuses = output.runs.map((r) => r.status);
    expect(statuses).not.toContain('failed');
  });
});
