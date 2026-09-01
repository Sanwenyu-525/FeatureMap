/**
 * Candidate engine tests — Milestone 7 (docs/DEVELOPMENT_PLAN.md),
 * ADR-0003 §3–5.
 *
 * The synthetic graph pins the deterministic scoring rules: depth cap,
 * distance decay, fan-in penalty, owns/DEPENDS_ON separation and the
 * explainable evidence chain.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_TRAVERSAL_DEPTH,
  chainFingerprint,
  expandCandidates,
  resolveAnchors,
  type AnchorNode,
  type EvidenceRowLike,
} from '../src/candidates.js';

const CALLS = (
  from: string,
  to: string,
  confidence = 1.0,
): EvidenceRowLike => ({
  sourceType: from.includes(':') ? 'symbol' : 'file',
  sourceId: from,
  relationType: 'CALLS',
  targetType: 'symbol',
  targetId: to,
  confidence,
});

const IMPORTS = (from: string, to: string): EvidenceRowLike => ({
  sourceType: 'file',
  sourceId: from,
  relationType: 'IMPORTS',
  targetType: 'file',
  targetId: to,
  confidence: 1.0,
});

const CONTAINS = (from: string, to: string): EvidenceRowLike => ({
  sourceType: 'file',
  sourceId: from,
  relationType: 'CONTAINS',
  targetType: 'symbol',
  targetId: to,
  confidence: 1.0,
  metadata: { kind: 'function' },
});

const fileAnchor = (nodeId: string): AnchorNode => ({
  featureId: 'feature:login',
  nodeType: 'file',
  nodeId,
  source: 'file',
});

describe('expandCandidates', () => {
  it('anchors become declared owns candidates with score 1', () => {
    const candidates = expandCandidates([fileAnchor('src/login.ts')], []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      featureId: 'feature:login',
      targetType: 'file',
      targetId: 'src/login.ts',
      relation: 'owns',
      status: 'declared',
      score: 1,
      distance: 0,
      evidenceChain: [],
    });
  });

  it('scores decay with distance and separate owns from DEPENDS_ON', () => {
    // a →(IMPORTS) b →(IMPORTS) c →(IMPORTS) d →(IMPORTS) e
    const evidence = [
      IMPORTS('src/a.ts', 'src/b.ts'),
      IMPORTS('src/b.ts', 'src/c.ts'),
      IMPORTS('src/c.ts', 'src/d.ts'),
      IMPORTS('src/d.ts', 'src/e.ts'),
    ];
    const candidates = expandCandidates([fileAnchor('src/a.ts')], evidence);
    const byTarget = new Map(candidates.map((c) => [c.targetId, c]));

    expect(byTarget.get('src/b.ts')).toMatchObject({ relation: 'owns', distance: 1 });
    expect(byTarget.get('src/c.ts')).toMatchObject({ relation: 'DEPENDS_ON', distance: 2 });
    expect(byTarget.get('src/d.ts')).toMatchObject({ relation: 'DEPENDS_ON', distance: 3 });

    // Traversal stops at the depth cap — e is 4 hops away.
    expect(byTarget.has('src/e.ts')).toBe(false);
    expect(MAX_TRAVERSAL_DEPTH).toBe(3);

    // Monotone decay across distances.
    const b = byTarget.get('src/b.ts')!.score;
    const c = byTarget.get('src/c.ts')!.score;
    const d = byTarget.get('src/d.ts')!.score;
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
  });

  it('down-weights high fan-in shared infrastructure', () => {
    // logger is imported by four files (high fan-in), util by one.
    const evidence = [
      IMPORTS('src/feature/one.ts', 'src/shared/logger.ts'),
      IMPORTS('src/feature/two.ts', 'src/shared/logger.ts'),
      IMPORTS('src/feature/three.ts', 'src/shared/logger.ts'),
      IMPORTS('src/feature/four.ts', 'src/shared/logger.ts'),
      IMPORTS('src/feature/one.ts', 'src/feature/util.ts'),
    ];
    const candidates = expandCandidates([fileAnchor('src/feature/one.ts')], evidence);
    const byTarget = new Map(candidates.map((c) => [c.targetId, c]));

    const logger = byTarget.get('src/shared/logger.ts')!;
    const util = byTarget.get('src/feature/util.ts')!;
    expect(logger.fanIn).toBe(4);
    expect(util.fanIn).toBe(1);
    expect(logger.score).toBeLessThan(util.score);
  });

  it('keeps CONTAINS hops free: a file\'s symbols are its own code', () => {
    const evidence = [
      CONTAINS('src/login.ts', 'symbol:src/login.ts:login'),
      CALLS('symbol:src/login.ts:login', 'symbol:src/auth/auth-service.ts:login', 0.9),
    ];
    const candidates = expandCandidates([fileAnchor('src/login.ts')], evidence);
    const byTarget = new Map(candidates.map((c) => [c.targetId, c]));

    // Symbol contained in the anchor file: distance 0, ownership.
    expect(byTarget.get('src/login.ts:login')).toMatchObject({
      targetType: 'symbol',
      distance: 0,
      relation: 'owns',
      status: 'suggested',
    });
    // One relational hop (a method call, 0.9) away.
    expect(byTarget.get('src/auth/auth-service.ts:login')).toMatchObject({
      distance: 1,
      relation: 'owns',
    });
    // The chain is explainable end to end.
    const chain = byTarget.get('src/auth/auth-service.ts:login')!.evidenceChain;
    expect(chain).toHaveLength(2);
    expect(chain[0]).toMatchObject({ relationType: 'CONTAINS', sourceId: 'src/login.ts' });
    expect(chain[1]).toMatchObject({
      relationType: 'CALLS',
      sourceId: 'src/login.ts:login',
      confidence: 0.9,
    });
  });

  it('marks a distance-1 cross-feature import as DEPENDS_ON, never ownership (release-gate P2)', () => {
    // login imports a billing hook directly (distance 1); billing also
    // anchors the same file. The file is billing's code, so login must
    // see it as a dependency — the dify `use-ps-info.ts` misjudgment.
    const evidence = [
      IMPORTS('src/login/login-page.ts', 'src/billing/use-ps-info.ts'),
      IMPORTS('src/billing/use-ps-info.ts', 'src/billing/billing-service.ts'),
    ];
    const anchors: AnchorNode[] = [
      { featureId: 'feature:login', nodeType: 'file', nodeId: 'src/login/login-page.ts', source: 'file' },
      { featureId: 'feature:billing', nodeType: 'file', nodeId: 'src/billing/use-ps-info.ts', source: 'file' },
    ];
    const candidates = expandCandidates(anchors, evidence);
    const byKey = new Map(candidates.map((c) => [`${c.featureId}|${c.targetId}`, c]));

    // billing owns its own anchor file (declared).
    expect(byKey.get('feature:billing|src/billing/use-ps-info.ts')).toMatchObject({
      relation: 'owns',
      status: 'declared',
      distance: 0,
    });
    // login reaches it at distance 1, but it is billing's code.
    expect(byKey.get('feature:login|src/billing/use-ps-info.ts')).toMatchObject({
      relation: 'DEPENDS_ON',
      distance: 1,
    });
    // login's own dependency chain still resolves to ownership for
    // modules it reaches first (single-owner, closest anchor wins).
    expect(byKey.has('feature:login|src/billing/billing-service.ts')).toBe(true);
  });

  it('produces deterministic output and fingerprints', () => {
    const evidence = [IMPORTS('src/a.ts', 'src/b.ts'), CONTAINS('src/a.ts', 'symbol:src/a.ts:foo')];
    const anchors = [fileAnchor('src/a.ts')];
    const first = expandCandidates(anchors, evidence);
    const second = expandCandidates(anchors, evidence);
    expect(second).toEqual(first);
    const foo = first.find((c) => c.targetId === 'src/a.ts:foo')!;
    expect(foo.fingerprint).toBe(chainFingerprint(foo.evidenceChain));
    expect(foo.fingerprint).toHaveLength(16);
  });
});

describe('resolveAnchors', () => {
  const evidence: EvidenceRowLike[] = [
    {
      sourceType: 'endpoint',
      sourceId: 'endpoint:POST /api/login',
      relationType: 'ROUTES_TO',
      targetType: 'file',
      targetId: 'src/server.ts',
      confidence: 1.0,
    },
    {
      sourceType: 'endpoint',
      sourceId: 'endpoint:POST /api/login',
      relationType: 'HANDLED_BY',
      targetType: 'symbol',
      targetId: 'symbol:src/server.ts:loginHandler',
      confidence: 1.0,
    },
  ];

  it('route anchors resolve to the handler symbol, not the hub registration file', () => {
    const anchors = resolveAnchors(
      [{ featureId: 'feature:login', name: 'POST /api/login' }],
      [],
      evidence,
    );
    // Only the handler — a hub file registering many resources must not
    // pull other features' chains in through its imports.
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toEqual({
      featureId: 'feature:login',
      nodeType: 'symbol',
      nodeId: 'src/server.ts:loginHandler',
      source: 'route',
    });
  });

  it('inline-handler endpoints fall back to the registration file anchor', () => {
    const anchors = resolveAnchors(
      [{ featureId: 'feature:login', name: 'POST /api/ping' }],
      [],
      [
        {
          sourceType: 'endpoint',
          sourceId: 'endpoint:POST /api/ping',
          relationType: 'ROUTES_TO',
          targetType: 'file',
          targetId: 'src/ping.ts',
          confidence: 1.0,
        },
      ],
    );
    expect(anchors).toEqual([
      { featureId: 'feature:login', nodeType: 'file', nodeId: 'src/ping.ts', source: 'route' },
    ]);
  });

  it('resolves declared file/symbol/route anchors', () => {
    const anchors = resolveAnchors(
      [],
      [
        { featureId: 'feature:login', type: 'file', target: 'src/login/page.tsx' },
        { featureId: 'feature:login', type: 'symbol', target: 'symbol:src/auth.ts:login' },
        { featureId: 'feature:login', type: 'route', target: 'POST /api/login' },
      ],
      evidence,
    );
    expect(anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeType: 'file', nodeId: 'src/login/page.tsx', source: 'file' }),
        expect.objectContaining({ nodeType: 'symbol', nodeId: 'src/auth.ts:login', source: 'symbol' }),
        expect.objectContaining({ nodeType: 'symbol', nodeId: 'src/server.ts:loginHandler', source: 'route' }),
      ]),
    );
  });
});
