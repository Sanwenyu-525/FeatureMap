/**
 * Path normalization helpers (docs/TESTING_STRATEGY.md §2 lists this
 * as a unit-test target). All internal paths are POSIX-style relative
 * to the repository root.
 */

/** Convert a repository file path to the canonical POSIX-style form. */
export function normalizePath(input: string): string {
  let p = input.replace(/\\/g, '/').trim();
  // Collapse duplicate slashes except for a leading UNC prefix.
  if (p.startsWith('//')) {
    p = '//' + p.slice(2).replace(/\/{2,}/g, '/');
  } else {
    p = p.replace(/\/{2,}/g, '/');
  }
  // Strip a single trailing slash (but keep a bare "/").
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Resolve `path` against the repository root, stripping the root prefix
 * when present and removing `.` / `..` segments. Returns a canonical
 * POSIX-style path relative to the root.
 */
export function resolveRelativePath(root: string, path: string): string {
  const rootParts = normalizePath(root).split('/').filter((s) => s !== '' && s !== '.');
  const pathParts = normalizePath(path).split('/').filter((s) => s !== '' && s !== '.');

  // Strip the root prefix if the path is rooted under it.
  if (
    rootParts.length > 0 &&
    pathParts.length >= rootParts.length &&
    rootParts.every((part, i) => part === pathParts[i])
  ) {
    pathParts.splice(0, rootParts.length);
  }

  const out: string[] = [];
  for (const part of pathParts) {
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

/** Check whether a normalized path matches an ignore rule ending in `/**`. */
export function matchesIgnorePrefix(normalizedPath: string, ignoreRule: string): boolean {
  const rule = normalizePath(ignoreRule).replace(/\/\*\*$/, '');
  if (rule === '') return false;
  return normalizedPath === rule || normalizedPath.startsWith(rule + '/');
}
