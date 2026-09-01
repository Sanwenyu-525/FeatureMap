import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher, ignoreRuleToRegExp } from '../src/ignore.js';

describe('ignoreRuleToRegExp', () => {
  it('matches exact file rules', () => {
    expect(ignoreRuleToRegExp('.env').test('.env')).toBe(true);
    expect(ignoreRuleToRegExp('.env').test('config/.env')).toBe(false);
  });

  it('supports single-star patterns like .env.*', () => {
    const re = ignoreRuleToRegExp('.env.*');
    expect(re.test('.env.local')).toBe(true);
    expect(re.test('config/.env.local')).toBe(false);
  });

  it('supports directory rules ending in /**', () => {
    const re = ignoreRuleToRegExp('node_modules/**');
    expect(re.test('node_modules')).toBe(true);
    expect(re.test('node_modules/pkg/index.js')).toBe(true);
    expect(re.test('src/node_modules-like.js')).toBe(false);
  });

  it('does not match sibling directories with a shared prefix', () => {
    expect(ignoreRuleToRegExp('dist/**').test('dist-utils/x.js')).toBe(false);
  });
});

describe('createIgnoreMatcher', () => {
  const matcher = createIgnoreMatcher(['node_modules/**', '.env', '.env.*', 'coverage/**']);

  it('matches any configured rule', () => {
    expect(matcher.matches('.env')).toBe(true);
    expect(matcher.matches('.env.production')).toBe(true);
    expect(matcher.matches('coverage/lcov-report/index.html')).toBe(true);
  });

  it('keeps normal source files', () => {
    expect(matcher.matches('src/auth/login.tsx')).toBe(false);
  });
});
