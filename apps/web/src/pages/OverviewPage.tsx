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
        <PageTitle title="概览" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!overview || !project) return <p className="text-sm text-slate-500">加载中…</p>;

  return (
    <>
      <PageTitle
        title={project.name}
        subtitle={`${project.currentBranch ?? '未知分支'} · 基准分支 ${project.baseBranch}`}
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="功能" value={overview.counts.features} />
        <StatCard label="文件" value={overview.counts.files} />
        <StatCard label="端点" value={overview.counts.endpoints} />
        <StatCard label="测试" value={overview.counts.tests} />
        <StatCard label="文档" value={overview.counts.documents} />
        <StatCard label="规则" value={overview.counts.instructions} />
      </div>
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-medium text-slate-700">技术栈</h2>
        <div className="flex flex-wrap gap-2">
          {project.technologies.length === 0 ? (
            <p className="text-sm text-slate-500">未检测到技术栈。</p>
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
          当前变更：{overview.currentImpact.changedFiles} 个文件 →
        </Link>
      </section>
    </>
  );
}
