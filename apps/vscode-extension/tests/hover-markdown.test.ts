/**
 * Hover markdown tests (v0.6.2 plan §7.4/§7.5).
 */
import { describe, expect, it } from 'vitest';
import type { IdeCodeIntelligence } from '../src/client/featuremap-client';
import { commandUri, renderHoverMarkdownSource } from '../src/providers/hover-markdown';

const info: IdeCodeIntelligence = {
  symbol: { id: 'symbol:src/auth.ts:login', name: 'login', filePath: 'src/auth.ts' },
  primaryFeature: { id: 'feature:login', name: 'Login', relation: 'OWNS', confidence: 0.96 },
  relatedFeatures: [],
  directDependencies: [
    { symbolId: 'symbol:src/auth.ts:validateToken', name: 'validateToken', filePath: 'src/auth.ts' },
    { symbolId: 'symbol:src/session.ts:create', name: 'create', filePath: 'src/session.ts' },
  ],
  tests: [{ path: 'tests/login.test.ts' }],
};

describe('renderHoverMarkdownSource', () => {
  it('renders a compact orientation', () => {
    const md = renderHoverMarkdownSource(info);
    expect(md).toContain('**FeatureMap**');
    expect(md).toContain('**Login** — OWNS · 96%');
    expect(md).toContain('**Direct dependencies**');
    expect(md).toContain('`validateToken`');
    expect(md).toContain('`create`');
    expect(md).toContain('**Tests**');
    expect(md).toContain('`tests/login.test.ts`');
  });

  it('links to Explain relation and Open feature', () => {
    const md = renderHoverMarkdownSource(info);
    expect(md).toContain('featuremap.explainRelation');
    expect(md).toContain('featuremap.openFeature');
  });

  it('omits sections that are empty', () => {
    const md = renderHoverMarkdownSource({
      ...info,
      directDependencies: [],
      tests: [],
      primaryFeature: undefined,
      relatedFeatures: [],
    });
    expect(md).not.toContain('Direct dependencies');
    expect(md).not.toContain('Tests');
    expect(md).not.toContain('Explain relation');
  });

  it('caps dependency/test counts', () => {
    const many: IdeCodeIntelligence = {
      ...info,
      directDependencies: Array.from({ length: 6 }, (_, i) => ({ name: `dep${i}` })),
      tests: Array.from({ length: 5 }, (_, i) => ({ path: `t${i}.test.ts` })),
    };
    const md = renderHoverMarkdownSource(many);
    expect(md.match(/`dep\d`/g)).toHaveLength(3);
    expect(md.match(/`t\d\.test\.ts`/g)).toHaveLength(2);
  });
});

describe('commandUri', () => {
  it('JSON-encodes arguments into the command URI', () => {
    const uri = commandUri('featuremap.explainRelation', ['feature:login', 'symbol:x']);
    expect(uri).toBe(
      `command:featuremap.explainRelation?${encodeURIComponent(JSON.stringify(['feature:login', 'symbol:x']))}`,
    );
  });
});
