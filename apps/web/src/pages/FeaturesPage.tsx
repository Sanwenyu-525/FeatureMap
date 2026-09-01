import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type FeatureListItem } from '../api/client';
import { ErrorNotice, PageTitle } from './shared';

export default function FeaturesPage() {
  const [features, setFeatures] = useState<FeatureListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .features()
      .then(setFeatures)
      .catch(setError);
  }, []);

  if (error) {
    return (
      <>
        <PageTitle title="Features" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!features) return <p className="text-sm text-slate-500">Loading…</p>;
  if (features.length === 0) {
    return (
      <>
        <PageTitle title="Features" subtitle="Hierarchical feature list grouped into product areas." />
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No features discovered yet. Feature discovery arrives with Milestone 2 — the scan
          already indexes files, endpoints, documents and Git evidence.
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title="Features" subtitle="Grouped by product capability; confidence reflects evidence strength." />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {features.map((f) => (
          <li key={f.id} className="px-4 py-3">
            <Link to={`/features/${encodeURIComponent(f.id)}`} className="font-medium hover:underline">
              {f.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{f.pattern}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                {f.confidence === 1 ? 'Confirmed' : f.confidence >= 0.5 ? 'Inferred' : 'Uncertain'}
              </span>
              {f.health ? (
                <>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      f.health.implementation === 'complete'
                        ? 'bg-emerald-50 text-emerald-700'
                        : f.health.implementation === 'partial'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    impl: {f.health.implementation}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      f.health.tests === 'present'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    tests: {f.health.tests}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      f.health.documentation === 'present'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    docs: {f.health.documentation}
                  </span>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
