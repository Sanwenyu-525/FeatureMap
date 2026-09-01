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
        <PageTitle title="功能" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!features) return <p className="text-sm text-slate-500">加载中…</p>;
  if (features.length === 0) {
    return (
      <>
        <PageTitle title="功能" subtitle="按产品能力分组的功能列表。" />
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          尚未发现任何功能。功能发现能力随 Milestone 2 提供——扫描已经索引文件、端点、文档与 Git 证据。
        </div>
      </>
    );
  }

  return (
    <>
      <PageTitle title="功能" subtitle="按产品能力分组；置信度反映证据强度。" />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {features.map((f) => (
          <li key={f.id} className="px-4 py-3">
            <Link to={`/features/${encodeURIComponent(f.id)}`} className="font-medium hover:underline">
              {f.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{f.pattern}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700">
                {f.confidence === 1 ? '已确认' : f.confidence >= 0.5 ? '推断' : '不确定'}
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
                    实现: {f.health.implementation}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      f.health.tests === 'present'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    测试: {f.health.tests}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      f.health.documentation === 'present'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-red-50 text-red-600'
                    }`}
                  >
                    文档: {f.health.documentation}
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
