/**
 * Thin Web Context Panel (v0.7.0, Milestone 25 §Stage 2).
 *
 * A first-party consumer of `POST /api/context`: Build (explicit, never
 * auto), optional Task input, Copy (canonical markdown via
 * navigator.clipboard inside the click handler), Recommended Files
 * (copy path only — no Source Browser) and a verbatim Markdown preview.
 * The preview renders the canonical markdown as text (`<pre>`), so no
 * raw HTML is ever interpreted — the browser surface stays safe.
 */
import { useState } from 'react';
import { api, type ContextDocument } from '../api/client';
import { ErrorNotice } from './shared';

export default function ContextPanel({ featureId, featureName }: { featureId: string; featureName: string }) {
  const [task, setTask] = useState('');
  const [document, setDocument] = useState<ContextDocument | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const build = () => {
    setBuilding(true);
    setError(null);
    api
      .context(featureId, task.trim().length > 0 ? task.trim() : undefined)
      .then((doc) => setDocument(doc))
      .catch(setError)
      .finally(() => setBuilding(false));
  };

  const copy = () => {
    if (!document) return;
    void navigator.clipboard.writeText(document.markdown).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const copyPath = (path: string) => {
    void navigator.clipboard.writeText(path).then(() => {
      setCopiedPath(path);
      window.setTimeout(() => setCopiedPath(null), 1500);
    });
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-medium text-slate-700">AI Context（{featureName}）</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Task（可选，仅改变排序）"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        />
        <button
          onClick={build}
          disabled={building}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {building ? '构建中…' : 'Build'}
        </button>
        {document ? (
          <button
            onClick={copy}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
          >
            {copied ? '已复制' : 'Copy'}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorNotice error={error} />
        </div>
      ) : null}
      {document ? (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recommended Files</h3>
              {document.recommendedFiles.length === 0 ? (
                <p className="text-sm text-slate-500">无推荐文件。</p>
              ) : (
                <ul className="space-y-1.5">
                  {document.recommendedFiles.map((f) => (
                    <li key={f.path} className="flex items-start gap-2 text-xs">
                      <button
                        onClick={() => copyPath(f.path)}
                        className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-400 ring-1 ring-slate-200 hover:text-indigo-600"
                        title="复制路径"
                      >
                        {copiedPath === f.path ? '✓' : '复制'}
                      </button>
                      <div className="min-w-0">
                        <p className="font-mono text-slate-700">{f.path}</p>
                        <p className="text-slate-400">
                          {f.roles.join(' · ')} — {f.reason}
                        </p>
                        {f.symbols && f.symbols.length > 0 ? (
                          <p className="font-mono text-[10px] text-indigo-500">
                            {f.symbols.map((s) => s.name).join(', ')}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Markdown Preview</h3>
              {/* Verbatim canonical markdown — never interpreted as HTML. */}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                {document.markdown}
              </pre>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
