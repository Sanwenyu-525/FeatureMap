/**
 * Stage 0 contract tests (v0.7.1, Milestone 26 §Stage 0) — mapping
 * benchmark schema validation and stable target resolution.
 */
import { describe, expect, it } from 'vitest';
import {
  parseMappingBenchmark,
  BenchmarkSpecError,
  type MappingBenchmarkSpec,
} from '../src/quality/load.js';
import { normalizeFeatureId, resolveTarget } from '../src/quality/resolve.js';

const valid = `{
  "version": 1,
  "features": [
    {
      "id": "login",
      "expected": [
        { "target": { "type": "file", "path": "src/auth/login-handler.ts" }, "relation": "OWNS", "confidenceClass": "must-high" },
        { "target": { "type": "symbol", "path": "src/auth/auth-service.ts", "symbol": "login" }, "relation": "OWNS", "confidenceClass": "may-suggest" }
      ],
      "notExpected": [
        { "target": { "type": "symbol", "path": "src/shared/logger.ts", "symbol": "info" }, "relation": "OWNS", "confidenceClass": "must-not-high", "tags": ["shared-infra"] }
      ]
    }
  ],
  "entities": [
    { "target": { "type": "file", "path": "src/shared/logger.ts" }, "tags": ["shared-infra", "high-fanin"] }
  ]
}`;

describe('parseMappingBenchmark (Stage 0 contract)', () => {
  it('parses a valid spec with features, entities and confidence classes', () => {
    const spec = parseMappingBenchmark(valid) as MappingBenchmarkSpec;
    expect(spec.version).toBe(1);
    expect(spec.features).toHaveLength(1);
    const login = spec.features[0]!;
    expect(login.expected).toHaveLength(2);
    expect(login.notExpected?.[0]?.confidenceClass).toBe('must-not-high');
    expect(spec.entities?.[0]?.tags).toContain('shared-infra');
  });

  it('rejects a wrong version', () => {
    expect(() => parseMappingBenchmark('{"version": 2, "features": []}')).toThrow(BenchmarkSpecError);
  });

  it('rejects a missing feature id', () => {
    expect(() => parseMappingBenchmark('{"version": 1, "features": [{"expected": []}]}')).toThrow(/feature.id/);
  });

  it('rejects an invalid relation', () => {
    expect(() =>
      parseMappingBenchmark(
        '{"version":1,"features":[{"id":"x","expected":[{"target":{"type":"file","path":"a.ts"},"relation":"IMPLEMENTS"}]}]}',
      ),
    ).toThrow(/relation/);
  });

  it('rejects an invalid confidenceClass', () => {
    expect(() =>
      parseMappingBenchmark(
        '{"version":1,"features":[{"id":"x","expected":[{"target":{"type":"file","path":"a.ts"},"relation":"OWNS","confidenceClass":"definitely"}]}]}',
      ),
    ).toThrow(/confidenceClass/);
  });

  it('rejects path traversal and absolute paths', () => {
    expect(() =>
      parseMappingBenchmark(
        '{"version":1,"features":[{"id":"x","expected":[{"target":{"type":"file","path":"../evil.ts"},"relation":"OWNS"}]}]}',
      ),
    ).toThrow(/relative/);
    expect(() =>
      parseMappingBenchmark(
        '{"version":1,"features":[{"id":"x","expected":[{"target":{"type":"file","path":"/etc/passwd"},"relation":"OWNS"}]}]}',
      ),
    ).toThrow(/relative/);
  });

  it('requires a symbol name for symbol targets', () => {
    expect(() =>
      parseMappingBenchmark(
        '{"version":1,"features":[{"id":"x","expected":[{"target":{"type":"symbol","path":"a.ts"},"relation":"OWNS"}]}]}',
      ),
    ).toThrow(/target.symbol/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseMappingBenchmark('{oops')).toThrow(/invalid JSON/);
  });
});

describe('resolveTarget (Stage 0 stable locator)', () => {
  it('maps a file target to its path', () => {
    expect(resolveTarget({ type: 'file', path: 'src/a.ts' })).toEqual({ id: 'src/a.ts', path: 'src/a.ts' });
  });

  it('maps a symbol target to path:name', () => {
    expect(resolveTarget({ type: 'symbol', path: 'src/a.ts', symbol: 'login' })).toEqual({
      id: 'src/a.ts:login',
      path: 'src/a.ts',
    });
  });

  it('normalizes backslashes for a Windows-safe corpus', () => {
    expect(resolveTarget({ type: 'file', path: 'src\\a.ts' }).id).toBe('src/a.ts');
  });

  it('normalizes feature ids', () => {
    expect(normalizeFeatureId('login')).toBe('feature:login');
    expect(normalizeFeatureId('feature:login')).toBe('feature:login');
  });
});
