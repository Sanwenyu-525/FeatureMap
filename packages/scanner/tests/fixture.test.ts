import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../src/scanner.js';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'test-fixtures',
  'react-express-basic',
);

describe('scanRepository on fixture', () => {
  it('inventories files with hashes and languages', () => {
    const scan = scanRepository(fixtureRoot, { ignore: ['node_modules/**', 'dist/**'] });
    const paths = scan.files.map((f) => f.path).sort();
    expect(paths).toContain('src/app.js');
    expect(paths).toContain('src/auth/login.js');
    expect(paths).toContain('prisma/schema.prisma');
    const appFile = scan.files.find((f) => f.path === 'src/app.js');
    expect(appFile?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(appFile?.language).toBe('JavaScript');
  });

  it('discovers documents per docs/MVP_SPEC.md §10', () => {
    const scan = scanRepository(fixtureRoot, { ignore: ['node_modules/**'] });
    const readme = scan.documents.find((d) => d.path === 'README.md');
    expect(readme?.type).toBe('readme');
  });

  it('detects technologies from package.json', () => {
    const scan = scanRepository(fixtureRoot, { ignore: ['node_modules/**'] });
    const ids = scan.technologies.map((t) => t.id);
    expect(ids).toContain('express');
    expect(ids).toContain('typescript');
  });

  it('produces stable file hashes across scans', () => {
    const a = scanRepository(fixtureRoot, { ignore: ['node_modules/**'] });
    const b = scanRepository(fixtureRoot, { ignore: ['node_modules/**'] });
    expect(a.files.map((f) => f.hash)).toEqual(b.files.map((f) => f.hash));
  });
});
