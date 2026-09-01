import { describe, expect, it } from 'vitest';
import { matchesIgnorePrefix, normalizePath, resolveRelativePath } from '../src/paths.js';

describe('normalizePath', () => {
  it('converts Windows separators to POSIX style', () => {
    expect(normalizePath('src\\auth\\login.tsx')).toBe('src/auth/login.tsx');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('src//auth///login.tsx')).toBe('src/auth/login.tsx');
  });

  it('strips a trailing slash but keeps a bare root', () => {
    expect(normalizePath('src/')).toBe('src');
    expect(normalizePath('/')).toBe('/');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePath('  src/auth  ')).toBe('src/auth');
  });
});

describe('resolveRelativePath', () => {
  it('strips the repository root prefix', () => {
    expect(resolveRelativePath('d:/Develop/repo', 'd:/Develop/repo/src/auth/login.tsx')).toBe(
      'src/auth/login.tsx',
    );
  });

  it('removes ./ and ../ segments', () => {
    expect(resolveRelativePath('repo', './src/./auth/../auth/login.tsx')).toBe('src/auth/login.tsx');
    expect(resolveRelativePath('repo', 'src/../package.json')).toBe('package.json');
  });

  it('keeps paths that are already relative', () => {
    expect(resolveRelativePath('repo', 'src/login.tsx')).toBe('src/login.tsx');
  });
});

describe('matchesIgnorePrefix (ignore rules)', () => {
  it('matches directories covered by a /** rule', () => {
    expect(matchesIgnorePrefix('node_modules/foo/index.js', 'node_modules/**')).toBe(true);
    expect(matchesIgnorePrefix('dist', 'dist/**')).toBe(true);
  });

  it('does not match sibling directories with a shared prefix', () => {
    expect(matchesIgnorePrefix('dist-utils/file.js', 'dist/**')).toBe(false);
  });

  it('does not treat /** rules as exact file matches elsewhere', () => {
    expect(matchesIgnorePrefix('src/auth/login.tsx', 'node_modules/**')).toBe(false);
  });
});
