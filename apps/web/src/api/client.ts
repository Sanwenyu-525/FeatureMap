/**
 * API client — mirror of docs/API_SPEC.md contracts (packages/server dto.ts).
 * Types are duplicated here so the browser bundle never depends on server code.
 */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ProjectResponse {
  name: string;
  root: string;
  baseBranch: string;
  currentBranch?: string;
  technologies: Array<{ id: string; confidence: number; source: string }>;
  lastScan?: string;
}

export interface OverviewResponse {
  counts: {
    features: number;
    files: number;
    endpoints: number;
    tests: number;
    documents: number;
    instructions: number;
  };
  health: { total: number; byState: Record<string, number> };
  currentImpact: { changedFiles: number; affectedFeatures: number };
}

export interface FeatureListItem {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
  status: string;
  updatedAt: string;
}

export interface FeatureDetail extends FeatureListItem {
  parentId?: string;
  assets: Array<{ id: string; type: string; path?: string; name?: string }>;
  documents: Array<{ path: string; title?: string }>;
  evidence: Array<{
    id: string;
    relationType: string;
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    confidence: number;
    analyzerId: string;
  }>;
}

export interface ChangesResponse {
  currentBranch?: string;
  baseBranch: string;
  changedFiles: Array<{ path: string; changeType: string; commitSha: string }>;
  affectedFeatures: Array<{ featureId: string; confidence: number; reasons: string[] }>;
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
}

export interface AnalyzerStatus {
  analyzerId: string;
  version: string;
  status: string;
  diagnostics: Array<{ level: string; code: string; message: string; path?: string }>;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  const body: unknown = text === '' ? null : JSON.parse(text);
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiRequestError(err?.code ?? 'UNKNOWN', err?.message ?? res.statusText, res.status);
  }
  return body as T;
}

export const api = {
  project: () => request<ProjectResponse>('/project'),
  overview: () => request<OverviewResponse>('/overview'),
  features: () => request<FeatureListItem[]>('/features'),
  feature: (id: string) => request<FeatureDetail>(`/features/${encodeURIComponent(id)}`),
  changes: () => request<ChangesResponse>('/changes'),
  analyzers: () => request<AnalyzerStatus[]>('/analyzers'),
  scan: (mode: 'incremental' | 'full') =>
    request<{ status: string; counts: Record<string, number> }>('/scan', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
};
