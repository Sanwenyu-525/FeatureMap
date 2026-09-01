# Local API Specification

## 1. Purpose

The local Fastify API is an application boundary between FeatureMap core and consumers such as the Web UI.

MVP APIs are local-only by default and should bind to loopback unless explicitly configured otherwise.

Base URL:

```text
http://127.0.0.1:7331/api
```

## 2. Response principles

- APIs return consumer-oriented DTOs, not raw database rows.
- Confidence and evidence source must be preserved where relevant.
- Large source files must not be returned by default.
- Errors should use stable machine-readable codes.

## 3. Endpoints

### `GET /project`

Returns project metadata and analyzer status.

```ts
interface ProjectResponse {
  name: string;
  root: string;
  baseBranch: string;
  currentBranch: string;
  technologies: TechnologyDetection[];
  lastScan?: string;
}
```

### `GET /overview`

Returns dashboard summary.

```ts
interface OverviewResponse {
  counts: {
    features: number;
    files: number;
    endpoints: number;
    tests: number;
    documents: number;
    instructions: number;
  };
  health: FeatureHealthSummary;
  currentImpact: ImpactSummary;
}
```

### `GET /features`

Query parameters:

```text
q
parentId
pattern
health
changed
```

Returns lightweight feature list/tree DTOs.

### `GET /features/:id`

Returns complete Feature Detail context.

### `GET /features/:id/evidence`

Returns explainability paths and individual evidence records.

### `GET /changes`

Returns current Git change set and affected features.

Optional query:

```text
base=<branch-or-ref>
```

### `POST /scan`

Starts a scan in the current process.

MVP may perform this synchronously or stream local progress; do not introduce a cloud job queue.

Request:

```json
{
  "mode": "incremental"
}
```

Allowed modes:

- `incremental`
- `full`

### `GET /analyzers`

Returns analyzer detection/run status and diagnostics.

## 4. Error envelope

```ts
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

Example codes:

```text
PROJECT_NOT_INITIALIZED
SCAN_FAILED
FEATURE_NOT_FOUND
INVALID_CONFIG
GIT_UNAVAILABLE
ANALYZER_FAILED
```

## 5. Source access

If a future UI needs source snippets, expose a dedicated bounded endpoint rather than embedding full contents in Feature DTOs.

Potential contract:

```text
GET /assets/:id/snippet?startLine=10&endLine=40
```

Enforce limits.

