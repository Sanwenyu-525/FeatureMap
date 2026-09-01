import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type Candidate, type FeatureDetail } from '../api/client';
import { ErrorNotice, PageTitle, HEALTH_LABELS } from './shared';
import FeatureFlowView from './FeatureFlowView';

const STATUS_LABELS: Record<Candidate['status'], string> = {
  declared: '锚点',
  suggested: '建议',
  accepted: '已确认',
  rejected: '已拒绝',
  superseded: '待重审',
};

const STATUS_STYLES: Record<Candidate['status'], string> = {
  declared: 'bg-slate-100 text-slate-600',
  suggested: 'bg-indigo-50 text-indigo-600',
  accepted: 'bg-emerald-50 text-emerald-600',
  rejected: 'bg-red-50 text-red-500',
  superseded: 'bg-amber-50 text-amber-600',
};

function CandidateRow({
  candidate,
  onVerdict,
}: {
  candidate: Candidate;
  onVerdict: (targetId: string, verdict: 'accepted' | 'rejected') => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const percent = `${Math.round(candidate.score * 100)}%`;
  return (
    <li className="border-b border-slate-100 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 text-right font-mono text-xs text-slate-500">{percent}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[candidate.status]}`}>
          {STATUS_LABELS[candidate.status]}
        </span>
        <span className="text-[10px] text-slate-400">{candidate.relation}</span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-slate-700 hover:text-indigo-600"
          title={candidate.targetId}
        >
          {candidate.targetId}
        </button>
        {candidate.status !== 'declared' ? (
          <span className="flex shrink-0 gap-1">
            <button
              onClick={() => onVerdict(candidate.targetId, 'accepted')}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                candidate.status === 'accepted'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              接受
            </button>
            <button
              onClick={() => onVerdict(candidate.targetId, 'rejected')}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                candidate.status === 'rejected'
                  ? 'bg-red-500 text-white'
                  : 'bg-white text-red-500 hover:bg-red-50'
              }`}
            >
              拒绝
            </button>
          </span>
        ) : null}
      </div>
      {expanded ? (
        <div className="mt-1 ml-12 rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
          <p>证据链（距离 {candidate.distance}，fan-in {candidate.fanIn}）：</p>
          {candidate.evidenceChain.map((step, i) => (
            <p key={i} className="mt-1">
              {step.sourceId} <span className="text-indigo-400">↓ {step.relationType}</span> ({step.confidence})
            </p>
          ))}
          <p className="mt-1">{candidate.targetId}</p>
        </div>
      ) : null}
    </li>
  );
}

export default function FeatureDetailPage() {
  const { id = '' } = useParams();
  const [feature, setFeature] = useState<FeatureDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<'flow' | 'lists'>('flow');

  useEffect(() => {
    setFeature(null);
    api
      .feature(id)
      .then(setFeature)
      .catch(setError);
  }, [id]);

  if (error) {
    return (
      <>
        <PageTitle title="功能详情" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!feature) return <p className="text-sm text-slate-500">加载中…</p>;

  const onVerdict = (targetId: string, verdict: 'accepted' | 'rejected') => {
    api
      .verdict(feature.id, targetId, verdict)
      .then(() => api.feature(feature.id))
      .then(setFeature)
      .catch(setError);
  };

  return (
    <>
      <PageTitle
        title={feature.name}
        subtitle={feature.description ?? `${feature.pattern} · 置信度 ${feature.confidence}`}
      />
      {feature.health ? (
        <div className="mb-6 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(feature.health).map(([dim, state]) => (
            <div key={dim} className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-slate-500">{HEALTH_LABELS[dim] ?? dim}</p>
              <p
                className={`font-medium ${
                  ['complete', 'present', 'clear'].includes(state)
                    ? 'text-emerald-600'
                    : ['partial'].includes(state)
                      ? 'text-amber-600'
                      : ['missing'].includes(state)
                        ? 'text-red-500'
                        : 'text-slate-400'
                }`}
              >
                {state}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-4 flex gap-2">
        {(['flow', 'lists'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              view === v ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {v === 'flow' ? '产品流视图' : '工程视图'}
          </button>
        ))}
      </div>
      {view === 'flow' ? (
        <FeatureFlowView feature={feature} />
      ) : (
        <>
          <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-medium text-slate-700">候选代码（可确认 / 拒绝）</h2>
            {feature.candidates.length === 0 ? (
              <p className="text-sm text-slate-500">暂无候选。重扫描后由锚点自动生成。</p>
            ) : (
              <ul>
                {feature.candidates.map((c) => (
                  <CandidateRow key={c.targetId} candidate={c} onVerdict={onVerdict} />
                ))}
              </ul>
            )}
          </section>
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium text-slate-700">实现资产</h2>
              {feature.assets.length === 0 ? (
                <p className="text-sm text-slate-500">暂无关联资产。</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {feature.assets.map((a) => (
                    <li key={a.id} className="font-mono text-xs">
                      [{a.type}] {a.path ?? a.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium text-slate-700">证据（为什么？）</h2>
              {feature.evidence.length === 0 ? (
                <p className="text-sm text-slate-500">暂无证据记录。</p>
              ) : (
                <ul className="space-y-1 font-mono text-xs text-slate-600">
                  {feature.evidence.map((e) => (
                    <li key={e.id}>
                      {e.sourceId} → {e.relationType} → {e.targetId} ({e.confidence}, {e.analyzerId})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
