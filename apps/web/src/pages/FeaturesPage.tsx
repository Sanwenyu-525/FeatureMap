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
      <PageTitle title="Features" />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {features.map((f) => (
          <li key={f.id} className="px-4 py-3">
            <Link to={`/features/${encodeURIComponent(f.id)}`} className="font-medium hover:underline">
              {f.name}
            </Link>
            <span className="ml-2 text-xs text-slate-500">{f.pattern}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
