import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type FeatureDetail } from '../api/client';
import { ErrorNotice, PageTitle } from './shared';
import FeatureFlowView from './FeatureFlowView';

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
        <PageTitle title="Feature Detail" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!feature) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <>
      <PageTitle
        title={feature.name}
        subtitle={feature.description ?? `${feature.pattern} · confidence ${feature.confidence}`}
      />
      {feature.health ? (
        <div className="mb-6 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          {Object.entries(feature.health).map(([dim, state]) => (
            <div key={dim} className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <p className="text-slate-500">{dim}</p>
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
            {v === 'flow' ? 'Product flow' : 'Engineering view'}
          </button>
        ))}
      </div>
      {view === 'flow' ? (
        <FeatureFlowView feature={feature} />
      ) : (
        <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Implementation assets</h2>
          {feature.assets.length === 0 ? (
            <p className="text-sm text-slate-500">No assets mapped.</p>
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
          <h2 className="mb-2 text-sm font-medium text-slate-700">Evidence ("Why?")</h2>
          {feature.evidence.length === 0 ? (
            <p className="text-sm text-slate-500">No evidence recorded.</p>
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
      )}
    </>
  );
}
