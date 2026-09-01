/**
 * Ignore rule matching (docs/ARCHITECTURE.md §2.1).
 *
 * Rules are glob-style strings such as `node_modules/**`, `dist/**`,
 * `.env` or `.env.*`. Matching operates on POSIX-style repo-relative
 * paths (docs/TESTING_STRATEGY.md §2 lists this as a unit-test target).
 */

/**
 * Compile one ignore rule to a RegExp.
 * - `**` matches any number of path segments (including `/`)
 * - `*` matches any characters except `/`
 * - `?` matches a single character except `/`
 */
export function ignoreRuleToRegExp(rule: string): RegExp {
  const normalized = rule.trim().replace(/^\//, '').replace(/\/$/, '');
  if (normalized === '') return /^$/;
  let pattern = '';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === undefined) break;
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        // A `/**` segment matches the directory itself and everything
        // below it — but not sibling names sharing the prefix
        // (e.g. `dist/**` must not match `dist-utils/...`).
        if (pattern.endsWith('/')) {
          pattern = pattern.slice(0, -1) + '(?:/.*)?';
        } else {
          pattern += '.*';
        }
        i += 2;
        if (normalized[i] === '/') i += 1;
      } else {
        pattern += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      pattern += '[^/]';
      i += 1;
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export interface IgnoreMatcher {
  rules: RegExp[];
  matches(path: string): boolean;
}

export function createIgnoreMatcher(rules: string[]): IgnoreMatcher {
  const compiled = rules.map(ignoreRuleToRegExp);
  return {
    rules: compiled,
    matches(path: string): boolean {
      return compiled.some((re) => re.test(path));
    },
  };
}
