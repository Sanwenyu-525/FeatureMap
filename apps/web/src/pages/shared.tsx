import { ApiRequestError } from '../api/client';

export function ErrorNotice({ error }: { error: unknown }) {
  if (error instanceof ApiRequestError) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">{error.code}</p>
        <p className="mt-1">{error.message}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">请求失败</p>
      <p className="mt-1">{error instanceof Error ? error.message : String(error)}</p>
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/** Explainable health dimension labels (docs/MVP_SPEC.md §9). */
export const HEALTH_LABELS: Record<string, string> = {
  implementation: '实现',
  api: 'API',
  tests: '测试',
  documentation: '文档',
  instructions: '规则',
  documentationDrift: '文档漂移',
};
