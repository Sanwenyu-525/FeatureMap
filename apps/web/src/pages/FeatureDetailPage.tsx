import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type FeatureDetail } from '../api/client';
import { ErrorNotice, PageTitle } from './shared';

export default function FeatureDetailPage() {
  const { id = '' } = useParams();
  const [feature, setFeature] = useState<FeatureDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

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
      <PageTitle title={feature.name} subtitle={feature.description ?? feature.pattern} />
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
                  {e.sourceId} → {e.relationType} → {e.targetId} ({e.confidence})
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
