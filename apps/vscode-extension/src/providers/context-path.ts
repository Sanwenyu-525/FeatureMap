/**
 * Artifact path guard for `featuremap.saveCurrentContext` (v0.6.5
 * plan §64–§71). The relative path is server-owned
 * (`.featuremap/context/<contextId>.md`), but the extension defends the
 * workspace boundary in depth: reject parent traversal, Windows
 * separators and absolute paths before `workspace.fs` writes.
 */
export function isSafeArtifactPath(relativePath: string): boolean {
  if (!relativePath.startsWith('.featuremap/context/')) return false;
  if (relativePath.includes('..') || relativePath.includes('\\') || relativePath.startsWith('/')) return false;
  return true;
}
