import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OverviewResponse, type ProjectResponse } from '../api/client';
import { ErrorNotice, PageTitle, StatCard } from './shared';

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([api.overview(), api.project()])
      .then(([o, p]) => {
        setOverview(o);
        setProject(p);
      })
      .catch(setError);
  }, []);

  if (error) {
    return (
      <>
        <PageTitle title="Overview" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!overview || !project) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <>
      <PageTitle
        title={project.name}
        subtitle={`${project.currentBranch ?? 'unknown branch'} · base ${project.baseBranch}`}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Features" value={overview.counts.features} />
        <StatCard label="Files" value={overview.counts.files} />
        <StatCard label="Endpoints" value={overview.counts.endpoints} />
        <StatCard label="Tests" value={overview.counts.tests} />
        <StatCard label="Documents" value={overview.counts.documents} />
        <StatCard label="Instructions" value={overview.counts.instructions} />
      </div>
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium text-slate-700">Technologies</h2>
        <div className="flex flex-wrap gap-2">
          {project.technologies.length === 0 ? (
            <p className="text-sm text-slate-500">None detected.</p>
          ) : (
            project.technologies.map((t) => (
              <span
                key={t.id}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
              >
                {t.id}
              </span>
            ))
          )}
        </div>
      </section>
      <section className="mt-8 text-sm">
        <Link to="/changes" className="text-indigo-600 hover:underline">
          Current changes: {overview.currentImpact.changedFiles} file(s) →
        </Link>
      </section>
    </>
  );
}
