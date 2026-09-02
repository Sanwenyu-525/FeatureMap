/**
 * Artifact path guard tests (v0.6.5 plan §64–§71, AGENTS.md §13).
 *
 * `featuremap.saveCurrentContext` must never write outside
 * `.featuremap/context/` even if the server-owned relative path were
 * tampered with: parent traversal, Windows separators and absolute
 * paths are all rejected before workspace.fs writes.
 */
import { describe, expect, it } from 'vitest';
import { isSafeArtifactPath } from '../src/providers/context-path';

describe('isSafeArtifactPath (plan §64–§71)', () => {
  it('accepts the canonical server-owned artifact path', () => {
    expect(isSafeArtifactPath('.featuremap/context/login.md')).toBe(true);
    expect(isSafeArtifactPath('.featuremap/context/login-3f2a9c11.md')).toBe(true);
  });

  it('rejects paths outside the context directory', () => {
    expect(isSafeArtifactPath('context/login.md')).toBe(false);
    expect(isSafeArtifactPath('.featuremap/login.md')).toBe(false);
    expect(isSafeArtifactPath('docs/login.md')).toBe(false);
    expect(isSafeArtifactPath('')).toBe(false);
  });

  it('rejects parent traversal', () => {
    expect(isSafeArtifactPath('.featuremap/context/../evil.md')).toBe(false);
    expect(isSafeArtifactPath('.featuremap/context/../../etc/passwd')).toBe(false);
  });

  it('rejects absolute paths and Windows separators', () => {
    expect(isSafeArtifactPath('/.featuremap/context/login.md')).toBe(false);
    expect(isSafeArtifactPath('.featuremap\\context\\login.md')).toBe(false);
  });
});
