import { useEffect, useState } from 'react';
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
        <PageTitle title="Changes" />
        <ErrorNotice error={error} />
      </>
    );
  }
  if (!changes) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <>
      <PageTitle
        title="Changes"
        subtitle={`${changes.currentBranch ?? 'unknown branch'} vs ${changes.baseBranch}`}
      />
      {changes.changedFiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No uncommitted changes in the working tree.
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
    </>
  );
}
