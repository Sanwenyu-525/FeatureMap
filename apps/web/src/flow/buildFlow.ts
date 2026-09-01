/**
 * Feature flow builder — docs/FEATURE_VISUALIZATION.md.
 *
 * The flow communicates what the feature DOES (product view) before
 * listing implementation details (engineering view). Semantic chains
 * follow the MVP pattern templates (§3); engineering assets attach to
 * them; every edge carries the confidence category (§6) so inferred
 * mappings stay visually distinguishable from confirmed facts.
 */
import type { FeatureDetail } from '../api/client';

export type ConfidenceCategory = 'Confirmed' | 'Inferred' | 'Uncertain';

export function confidenceCategory(confidence: number): ConfidenceCategory {
  if (confidence >= 1) return 'Confirmed';
  if (confidence >= 0.5) return 'Inferred';
  return 'Uncertain';
}

export interface FlowNode {
  id: string;
  label: string;
  /** Visual node category (docs/FEATURE_VISUALIZATION.md §5). */
  category: 'actor' | 'api' | 'service' | 'data' | 'code' | 'test' | 'document';
  detail?: string;
  confidence?: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  confidence?: number;
}

export interface FeatureFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** Semantic chain per MVP pattern (docs/FEATURE_VISUALIZATION.md §3). */
function semanticChain(pattern: string): Array<{ id: string; label: string; category: FlowNode['category'] }> {
  switch (pattern) {
    case 'Authentication':
      return [
        { id: 'sem:user', label: 'User', category: 'actor' },
        { id: 'sem:credentials', label: 'Credentials', category: 'data' },
        { id: 'sem:auth', label: 'Authentication', category: 'service' },
        { id: 'sem:session', label: 'Session / Token', category: 'data' },
      ];
    case 'CRUD':
      return [
        { id: 'sem:actor', label: 'Actor', category: 'actor' },
        { id: 'sem:crud', label: 'Create / Read / Update / Delete', category: 'service' },
        { id: 'sem:entity', label: 'Domain Entity', category: 'data' },
        { id: 'sem:persistence', label: 'Persistence', category: 'data' },
      ];
    case 'Workflow':
      return [
        { id: 'sem:start', label: 'Start', category: 'actor' },
        { id: 'sem:steps', label: 'Steps', category: 'service' },
        { id: 'sem:decision', label: 'Decision', category: 'service' },
        { id: 'sem:done', label: 'Completion', category: 'data' },
      ];
    case 'Event':
      return [
        { id: 'sem:trigger', label: 'Trigger', category: 'actor' },
        { id: 'sem:event', label: 'Event', category: 'service' },
        { id: 'sem:handler', label: 'Handler / Queue', category: 'service' },
      ];
    case 'Pipeline':
      return [
        { id: 'sem:input', label: 'Input', category: 'actor' },
        { id: 'sem:validation', label: 'Validation', category: 'service' },
        { id: 'sem:processing', label: 'Processing', category: 'service' },
        { id: 'sem:output', label: 'Storage / Output', category: 'data' },
      ];
    default:
      return [
        { id: 'sem:actor', label: 'Actor', category: 'actor' },
        { id: 'sem:action', label: 'Capability', category: 'service' },
        { id: 'sem:result', label: 'Result', category: 'data' },
      ];
  }
}

/**
 * Build the flow graph from the feature detail DTO. Deterministic: all
 * engineering nodes and edges derive from the stored assets/evidence.
 */
export function buildFlow(feature: FeatureDetail): FeatureFlow {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const chain = semanticChain(feature.pattern);
  chain.forEach((n) =>
    nodes.push({ id: n.id, label: n.label, category: n.category }),
  );
  // Attach the API chain.
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    if (!from || !to) continue;
    edges.push({
      id: `chain:${from.id}->${to.id}`,
      source: from.id,
      target: to.id,
      label: '',
    });
  }
  // The service node in the chain receives the engineering graph.
  const serviceAnchor =
    chain.find((n) => n.category === 'service')?.id ?? chain[chain.length - 1]?.id ?? 'sem:result';

  const endpointNodes = feature.assets.filter((a) => a.type === 'endpoint');
  const handlerSymbols = feature.assets.filter((a) => a.type === 'symbol');
  const codeFiles = feature.assets.filter((a) => a.type === 'file');
  const testFiles = feature.assets.filter((a) => a.type === 'test');

  // API nodes: real endpoints under the service anchor.
  for (const e of endpointNodes) {
    nodes.push({
      id: `api:${e.name ?? e.id}`,
      label: e.name ?? e.id,
      category: 'api',
      detail: e.path,
    });
    edges.push({
      id: `edge:${serviceAnchor}->api:${e.name ?? e.id}`,
      source: serviceAnchor,
      target: `api:${e.name ?? e.id}`,
      label: 'HANDLED_BY',
      confidence: 1,
    });
  }

  // Service nodes: handler symbols.
  for (const s of handlerSymbols) {
    nodes.push({
      id: `svc:${s.name ?? s.id}`,
      label: s.name ?? s.id,
      category: 'service',
      detail: s.path,
      confidence: 1,
    });
  }

  // Code nodes: implementation files from the closure.
  for (const f of codeFiles) {
    nodes.push({
      id: `code:${f.path ?? f.id}`,
      label: f.path ?? f.id,
      category: 'code',
      confidence: 0.9,
    });
  }

  // Test nodes: VERIFIED_BY relationship to the feature.
  for (const t of testFiles) {
    nodes.push({
      id: `test:${t.path ?? t.id}`,
      label: t.path ?? t.id,
      category: 'test',
      confidence: 1,
    });
    edges.push({
      id: `edge:test:${t.path ?? t.id}`,
      source: `test:${t.path ?? t.id}`,
      target: serviceAnchor,
      label: 'VERIFIED_BY',
      confidence: 1,
    });
  }

  // Document nodes: DESCRIBED_BY (reverse direction into the feature).
  for (const d of feature.documents) {
    nodes.push({ id: `doc:${d.path}`, label: d.path, category: 'document', confidence: 0.9 });
    edges.push({
      id: `edge:doc:${d.path}`,
      source: `code:${codeFiles[0]?.path ?? d.path}`,
      target: `doc:${d.path}`,
      label: 'DESCRIBED_BY',
      confidence: 0.9,
    });
  }

  // Connect API endpoints to their handler symbols when obvious by name
  // (deterministic: handler was resolved by the express/nestjs analyzer).
  for (const e of endpointNodes) {
    const handler = feature.evidence.find(
      (ev) =>
        ev.relationType === 'HANDLED_BY' &&
        ev.sourceType === 'endpoint' &&
        ev.sourceId === `endpoint:${e.name ?? ''}`,
    );
    if (handler) {
      const handlerName = handler.targetId.split(':').slice(1).join(':');
      if (handlerSymbols.some((s) => s.name === handlerName.split(':').pop())) {
        edges.push({
          id: `edge:api:${e.name}->handler`,
          source: `api:${e.name ?? e.id}`,
          target: `svc:${handlerName.split(':').pop()}`,
          label: 'HANDLED_BY',
          confidence: 1,
        });
      }
    }
  }

  return { nodes, edges };
}
