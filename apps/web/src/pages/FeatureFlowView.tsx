import { useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FeatureDetail } from '../api/client';
import { buildFlow, confidenceCategory, type FlowNode } from '../flow/buildFlow';

const CATEGORY_STYLES: Record<FlowNode['category'], string> = {
  actor: '#6366f1',
  api: '#0ea5e9',
  service: '#10b981',
  data: '#f59e0b',
  code: '#64748b',
  test: '#8b5cf6',
  document: '#ec4899',
};

function toFlowNodes(nodes: FlowNode[]): Node[] {
  return nodes.map((n, i) => ({
    id: n.id,
    position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 110 },
    data: { label: n.label },
    style: {
      background: '#fff',
      border: `2px solid ${CATEGORY_STYLES[n.category]}`,
      borderRadius: 8,
      fontSize: 11,
      padding: 6,
      width: 180,
    },
  }));
}

function toFlowEdges(edges: FeatureFlowEdges): Edge[] {
  return edges.map((e) => {
    const category = confidenceCategory(e.confidence ?? 1);
    const color = category === 'Confirmed' ? '#059669' : category === 'Inferred' ? '#2563eb' : '#d97706';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label || undefined,
      animated: category !== 'Confirmed',
      style: { stroke: color },
      labelStyle: { fill: color, fontSize: 10 },
    };
  });
}

type FeatureFlowEdges = ReturnType<typeof buildFlow>['edges'];

interface Selection {
  kind: 'node' | 'edge';
  id: string;
  label: string;
  category?: string;
  confidence?: number;
  evidence?: FeatureDetail['evidence'];
}

export default function FeatureFlowView({ feature }: { feature: FeatureDetail }) {
  const flow = useMemo(() => buildFlow(feature), [feature]);
  const nodes = useMemo(() => toFlowNodes(flow.nodes), [flow]);
  const edges = useMemo(() => toFlowEdges(flow.edges), [flow]);
  const [selection, setSelection] = useState<Selection | null>(null);

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    const flowNode = flow.nodes.find((n) => n.id === node.id);
    setSelection({
      kind: 'node',
      id: node.id,
      label: flowNode?.label ?? node.id,
      category: flowNode?.category,
      confidence: flowNode?.confidence,
      evidence: feature.evidence.filter((e) => e.sourceId.includes(node.id.replace(/^[a-z]+:/, ''))),
    });
  };

  return (
    <div className="flex gap-4">
      <div className="h-[480px] flex-1 rounded-lg border border-slate-200 bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="w-72 shrink-0 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Why? — evidence explanation
        </h3>
        {selection ? (
          <div>
            <p className="font-medium">{selection.label}</p>
            {selection.category ? (
              <p className="mt-1 text-xs text-slate-500">category: {selection.category}</p>
            ) : null}
            {selection.confidence !== undefined ? (
              <p className="mt-1 text-xs text-slate-500">
                confidence: {selection.confidence} ({confidenceCategory(selection.confidence)})
              </p>
            ) : null}
            <ul className="mt-3 space-y-2 font-mono text-xs text-slate-600">
              {selection.evidence && selection.evidence.length > 0 ? (
                selection.evidence.map((e) => (
                  <li key={e.id}>
                    {e.sourceId} → {e.relationType} → {e.targetId} ({e.confidence}, {e.analyzerId})
                  </li>
                ))
              ) : (
                <li className="text-slate-400">Select a node to inspect its evidence.</li>
              )}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Click any node to see the evidence chain behind it. Solid green edges are confirmed
            facts; animated blue edges are inferred (docs/FEATURE_VISUALIZATION.md §6).
          </p>
        )}
      </aside>
    </div>
  );
}
