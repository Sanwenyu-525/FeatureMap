/**
 * Anchor-driven candidate expansion — Milestone 7 (v0.2.1–v0.2.2),
 * ADR-0003 §3–5 and docs/releases/v0.2-acceptance.md.
 *
 * From a handful of feature anchors, traverse the evidence-backed code
 * graph and score candidate feature↔code relations. Everything is
 * deterministic and rule-based — no LLM participates (AGENTS.md §3.2).
 *
 * Model:
 * - relational edges (distance +1): IMPORTS (file→file), CALLS
 *   (→symbol), component-usage REFERENCES (→symbol)
 * - structural edges (distance +0): CONTAINS (file→symbol,
 *   class→method) — a file's symbols are the file's own code, not a
 *   hop away
 * - traversal depth is capped at MAX_TRAVERSAL_DEPTH relational hops
 * - score = pathConfidence × DISTANCE_DECAY^distance × fanInFactor —
 *   high fan-in shared infrastructure (logger, config, UI primitives)
 *   is down-weighted so it never surfaces as ownership
 * - owns: distance ≤ 1 (short, strong chain from the anchor);
 *   DEPENDS_ON: reached transitively (ADR-0003 §3)
 */
import { createHash } from 'node:crypto';

export const MAX_TRAVERSAL_DEPTH = 3;
const DISTANCE_DECAY = 0.85;
const FAN_IN_SOFT_CAP = 3;

/** An anchor resolved to a graph node. */
export interface AnchorNode {
  featureId: string;
  nodeType: 'file' | 'symbol';
  /** File path, or `symbol:<path>:<name>`. */
  nodeId: string;
  /** Provenance: 'route' (endpoint/CLI) or the declared anchor type. */
  source: string;
}

/** Minimal evidence row shape (works directly on analyzer output rows). */
export interface EvidenceRowLike {
  sourceType: string;
  sourceId: string;
  relationType: string;
  targetType: string;
  targetId: string;
  confidence: number;
  metadata?: Record<string, unknown> | null;
}

export interface CandidateEvidenceStep {
  relationType: string;
  sourceId: string;
  targetId: string;
  confidence: number;
}

export interface CandidateRelation {
  featureId: string;
  targetType: 'file' | 'symbol';
  targetId: string;
  relation: 'owns' | 'DEPENDS_ON';
  status: 'declared' | 'suggested';
  score: number;
  distance: number;
  fanIn: number;
  evidenceChain: CandidateEvidenceStep[];
  fingerprint: string;
}

interface GraphEdge {
  relationType: string;
  /** `file:<path>` or `symbol:<path>:<name>`. */
  from: string;
  to: string;
  confidence: number;
  structural: boolean;
}

interface BestPath {
  distance: number;
  pathConfidence: number;
  chain: GraphEdge[];
}

const graphNode = (nodeType: 'file' | 'symbol', id: string): string => `${nodeType}:${id}`;

/** Evidence symbol ids already carry the `symbol:` prefix — strip it so graph nodes stay single-prefixed. */
const stripSymbolPrefix = (id: string): string =>
  id.startsWith('symbol:') ? id.slice('symbol:'.length) : id;

function isRelationalEvidence(ev: EvidenceRowLike): boolean {
  if (ev.relationType === 'IMPORTS' && ev.sourceType === 'file' && ev.targetType === 'file') {
    return true;
  }
  if (ev.relationType === 'CALLS') return true;
  if (
    ev.relationType === 'REFERENCES' &&
    (ev.metadata as { usage?: string } | null)?.usage === 'component'
  ) {
    return true;
  }
  return false;
}

/** Stable fingerprint of an evidence chain (acceptance §4: verdict drift). */
export function chainFingerprint(chain: CandidateEvidenceStep[]): string {
  const hash = createHash('sha256');
  for (const step of chain) {
    hash.update(`${step.relationType}|${step.sourceId}|${step.targetId}|${step.confidence};`);
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Expand scored candidates from anchors over the evidence graph.
 * Deterministic: identical inputs produce identical outputs.
 */
export function expandCandidates(
  anchors: AnchorNode[],
  evidence: EvidenceRowLike[],
): CandidateRelation[] {
  // ---- Build the traversal graph ---------------------------------------
  const relational: GraphEdge[] = [];
  const structural: GraphEdge[] = [];
  const fanIn = new Map<string, number>();
  const seen = new Set<string>();

  for (const ev of evidence) {
    const sourceType = ev.sourceType === 'symbol' ? 'symbol' : 'file';
    const targetType = ev.targetType === 'symbol' ? 'symbol' : 'file';
    const isRelational = isRelationalEvidence(ev);
    if (!isRelational && ev.relationType !== 'CONTAINS') continue;
    const from = graphNode(
      sourceType as 'file' | 'symbol',
      sourceType === 'symbol' ? stripSymbolPrefix(ev.sourceId) : ev.sourceId,
    );
    const to = graphNode(
      targetType as 'file' | 'symbol',
      targetType === 'symbol' ? stripSymbolPrefix(ev.targetId) : ev.targetId,
    );
    const key = `${ev.relationType}|${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: GraphEdge = {
      relationType: ev.relationType,
      from,
      to,
      confidence: ev.confidence,
      structural: !isRelational,
    };
    (isRelational ? relational : structural).push(edge);
    if (isRelational) fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
  }

  // Deterministic edge order → stable chains and fingerprints.
  const byEdge = (a: GraphEdge, b: GraphEdge): number =>
    `${a.relationType}|${a.from}|${a.to}`.localeCompare(`${b.relationType}|${b.from}|${b.to}`);
  relational.sort(byEdge);
  structural.sort(byEdge);

  /**
   * Symbol candidate eligibility (docs/releases/v0.2-acceptance.md §2,
   * cross-feature boundary rule): a symbol is a candidate for a feature
   * only when a relational edge (CALLS / component usage) pointing at
   * it starts from a node that feature's traversal actually reaches —
   * per feature, never globally. CONTAINS is a traversal channel: a
   * shared boundary file's other symbols are not pulled into the
   * feature just because the file is.
   */
  const relationalSymbolEdges = relational
    .filter((e) => e.to.startsWith('symbol:'))
    .map((e) => ({ from: e.from, to: e.to }));

  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of [...relational, ...structural]) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const fanInFactor = (node: string): number =>
    Math.min(1, FAN_IN_SOFT_CAP / Math.max(1, fanIn.get(node) ?? 0));

  // ---- Best-path relaxation per feature --------------------------------
  const features = new Set(anchors.map((a) => a.featureId));
  const states = new Map<string, Map<string, BestPath>>();
  for (const featureId of features) states.set(featureId, new Map());

  for (const anchor of anchors) {
    states
      .get(anchor.featureId)!
      .set(graphNode(anchor.nodeType, anchor.nodeId), {
        distance: 0,
        pathConfidence: 1,
        chain: [],
      });
  }

  for (const featureStates of states.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const [node, state] of [...featureStates]) {
        for (const edge of outgoing.get(node) ?? []) {
          const nextDistance = state.distance + (edge.structural ? 0 : 1);
          if (nextDistance > MAX_TRAVERSAL_DEPTH) continue;
          const next: BestPath = {
            distance: nextDistance,
            pathConfidence: state.pathConfidence * edge.confidence,
            chain: [...state.chain, edge],
          };
          const current = featureStates.get(edge.to);
          const better =
            current === undefined ||
            next.distance < current.distance ||
            (next.distance === current.distance &&
              next.pathConfidence > current.pathConfidence);
          if (better) {
            featureStates.set(edge.to, next);
            changed = true;
          }
        }
      }
    }
  }

  // ---- Materialize candidates ------------------------------------------
  const candidates: CandidateRelation[] = [];
  for (const [featureId, featureStates] of states) {
    // Per-feature eligibility: a relational edge into a symbol counts
    // only when its source is inside THIS feature's reachable set.
    const eligibleSymbols = new Set(
      relationalSymbolEdges
        .filter((e) => featureStates.has(e.from))
        .map((e) => e.to),
    );
    for (const [node, state] of featureStates) {
      const targetType: 'file' | 'symbol' = node.startsWith('symbol:') ? 'symbol' : 'file';
      const targetId = node.slice(targetType.length + 1);
      const isAnchor = state.distance === 0 && state.chain.length === 0;
      // Boundary rule: symbols reached only through CONTAINS at distance
      // > 0 (their containing file was pulled in transitively) need a
      // relational edge of their own — from this feature's own reached
      // set. Symbols of anchor files themselves (distance 0) are part
      // of the anchor.
      if (
        targetType === 'symbol' &&
        !isAnchor &&
        state.distance > 0 &&
        !eligibleSymbols.has(node)
      ) {
        continue;
      }
      const score = isAnchor
        ? 1
        : Math.min(
            1,
            state.pathConfidence *
              Math.pow(DISTANCE_DECAY, state.distance) *
              fanInFactor(node),
          );
      const chain: CandidateEvidenceStep[] = state.chain.map((edge) => ({
        relationType: edge.relationType,
        sourceId: edge.from.startsWith('symbol:') ? edge.from.slice('symbol:'.length) : edge.from.slice('file:'.length),
        targetId: edge.to.startsWith('symbol:') ? edge.to.slice('symbol:'.length) : edge.to.slice('file:'.length),
        confidence: edge.confidence,
      }));
      candidates.push({
        featureId,
        targetType,
        targetId,
        relation: state.distance <= 1 ? 'owns' : 'DEPENDS_ON',
        status: isAnchor ? 'declared' : 'suggested',
        score: Number(score.toFixed(4)),
        distance: state.distance,
        fanIn: fanIn.get(node) ?? 0,
        evidenceChain: chain,
        fingerprint: chainFingerprint(chain),
      });
    }
  }

  return candidates.sort(
    (a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId),
  );
}

/**
 * Resolve anchor declarations to graph nodes.
 *
 * Route anchors (endpoint/CLI assets discovered per feature) resolve
 * through ROUTES_TO (→ file) and HANDLED_BY (→ symbol) evidence.
 * Declared file/symbol/component anchors resolve directly; route
 * declarations resolve like discovered endpoints.
 */
export function resolveAnchors(
  endpointAnchors: Array<{ featureId: string; name: string }>,
  declared: Array<{ featureId: string; type: string; target: string }>,
  evidence: EvidenceRowLike[],
): AnchorNode[] {
  const anchors: AnchorNode[] = [];
  const routeTargets = new Map(evidence
    .filter((ev) => ev.relationType === 'ROUTES_TO' || ev.relationType === 'HANDLED_BY')
    .map((ev) => [`${ev.relationType}|${ev.sourceId}`, ev] as const));

  const resolveRoute = (featureId: string, name: string): void => {
    const sourceIds = [`endpoint:${name}`, `cli_command:${name}`];
    for (const sourceId of sourceIds) {
      // The handler symbol is the feature's entry. The file that merely
      // registers the route is NOT an anchor: a hub file registering
      // many resources would otherwise pull every other feature's chain
      // into this one (same insight as the discovery-side hub rule).
      const handler = routeTargets.get(`HANDLED_BY|${sourceId}`);
      if (handler) {
        anchors.push({
          featureId,
          nodeType: 'symbol',
          nodeId: stripSymbolPrefix(handler.targetId),
          source: 'route',
        });
        continue;
      }
      // Inline handlers have no symbol — the registration file proves
      // implementation and becomes the anchor.
      const route = routeTargets.get(`ROUTES_TO|${sourceId}`);
      if (route) {
        anchors.push({ featureId, nodeType: 'file', nodeId: route.targetId, source: 'route' });
      }
    }
  };

  for (const endpoint of endpointAnchors) resolveRoute(endpoint.featureId, endpoint.name);

  for (const decl of declared) {
    if (decl.type === 'file') {
      anchors.push({ featureId: decl.featureId, nodeType: 'file', nodeId: decl.target, source: 'file' });
    } else if (decl.type === 'symbol' || decl.type === 'component') {
      anchors.push({
        featureId: decl.featureId,
        nodeType: 'symbol',
        nodeId: stripSymbolPrefix(decl.target),
        source: decl.type,
      });
    } else if (decl.type === 'route') {
      resolveRoute(decl.featureId, decl.target);
    }
  }

  return anchors;
}
