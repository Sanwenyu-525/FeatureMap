import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ChangesResponse } from '../api/client';
import { ErrorNotice, PageTitle } from './shared';

export default function ChangesPage() {
  const [changes, setChanges] = useState<ChangesResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .changes()
      .then(setChanges)
      .catch(setError);
  }, []);

  if (error) {
    return (
      <>
        <PageTitle title="变更" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!changes) return <p className="text-sm text-slate-500">加载中…</p>;

  return (
    <>
      <PageTitle
        title="变更"
        subtitle={`${changes.currentBranch ?? '未知分支'} 对比 ${changes.baseBranch}`}
      />
      {changes.changedFiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          工作区没有未提交的变更。
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {changes.changedFiles.map((c) => (
            <li key={`${c.path}:${c.changeType}`} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs uppercase text-slate-600">
                {c.changeType}
              </span>
              <span className="font-mono text-xs">{c.path}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mb-2 mt-8 text-sm font-medium text-slate-700">受影响的功能</h2>
      {changes.affectedFeatures.length === 0 ? (
        <p className="text-sm text-slate-500">没有达到可展示置信度的影响。</p>
      ) : (
        <ul className="space-y-3">
          {changes.affectedFeatures.map((f) => (
            <li key={f.featureId} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <Link
                  to={`/features/${encodeURIComponent(f.featureId)}`}
                  className="font-medium hover:underline"
                >
                  {f.featureName}
                </Link>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  置信度 {f.confidence}
                </span>
              </div>
              <ul className="mt-2 space-y-1 font-mono text-xs text-slate-500">
                {f.reasons.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {changes.potentiallyStaleDocuments.length > 0 ? (
        <>
          <h2 className="mb-2 mt-8 text-sm font-medium text-slate-700">可能过期的文档</h2>
          <ul className="space-y-1 text-sm">
            {changes.potentiallyStaleDocuments.map((d) => (
              <li key={d.path} className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                <span className="font-mono text-xs">{d.path}</span> — {d.reason}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
