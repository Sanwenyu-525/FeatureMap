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

Returns lightweight feature list/tree DTOs. Each item carries the
derived, explainable health object (docs/DATA_MODEL.md §5):

```ts
interface FeatureListItemDto {
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
  status: string;
  health?: FeatureHealth;
  updatedAt: string;
}
```

### `GET /features/:id`

Returns complete Feature Detail context: the feature list item fields
plus `assets`, `documents`, the scored `candidates` array (Milestone 7)
and the `BELONGS_TO_FEATURE` evidence chain with analyzer identity.
Unknown ids return the `FEATURE_NOT_FOUND` error envelope. Feature ids
contain `:` (for example `feature:login`); clients should URL-encode
them.

### `POST /features/:id/candidates/verdict`

Records a human verdict on a candidate (Milestone 8, ADR-0003 §4):

```json
{ "targetId": "src/shared/logger.ts", "verdict": "rejected" }
```

`verdict` must be `accepted` or `rejected`. Returns the updated row
status. Errors use the standard envelope with codes
`CANDIDATE_NOT_FOUND` (404), `AMBIGUOUS_TARGET` (400),
`ANCHOR_NOT_REVIEWABLE` (400) and `FEATURE_NOT_FOUND` (404). Verdicts
survive rescans; a changed evidence fingerprint marks the row
`superseded` for re-review (docs/releases/v0.2-acceptance.md §4).

### `GET /features/:id/evidence`

Returns explainability paths and individual evidence records
targeting the feature.

### `GET /changes`

Returns current Git change set (working tree plus `base...HEAD`
branch diff) and affected features produced by evidence-backed
traversal only (AGENTS.md §9):

```ts
interface ChangesResponse {
  currentBranch?: string;
  baseBranch: string;
  changedFiles: Array<{ path: string; changeType: string; commitSha: string }>;
  affectedFeatures: Array<{
    featureId: string;
    featureName: string;
    confidence: number;
    reasons: string[];
  }>;
  potentiallyStaleDocuments: Array<{ path: string; reason: string }>;
}
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

### `POST /context`

Returns the canonical read-only `FeatureContextDocument` (v0.7.0,
Milestone 25) — the same document the CLI / MCP / IDE produce, from the
single canonical renderer (`docs/DEVELOPMENT_PLAN.md` Milestone 25).

Request:

```json
{
  "featureId": "authentication",
  "task": "Add refresh token rotation"
}
```

- `featureId` (required): feature name or id.
- `task` (optional): free-text task. It lives **only** in the POST body
  — never in the URL/query (free text, avoids URL logs). Task changes
  ranking only, never the graph.

Response: the `FeatureContextDocument`
(`formatVersion`, `contextId`, `feature`, `task?`, `sections`,
`recommendedFiles`, `budget`, `artifact`, `markdown`) with
`Cache-Control: no-store` — the projection depends on the live graph
and working-tree state, so browsers must not cache it.

Errors:

- `FEATURE_NOT_FOUND` (404) — unknown feature.
- `INVALID_CONFIG` (400) — missing `featureId` or non-string `task`.
- `CONTEXT_BUILD_FAILED` (500) — builder failure.

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
CONTEXT_BUILD_FAILED
GIT_UNAVAILABLE
ANALYZER_FAILED
```

## 5. Static UI hosting

`featuremap dev` serves the built Web UI from the FeatureMap
installation (`apps/web/dist`) on the same loopback origin as the API,
with an SPA fallback for client-side routes. Unknown `/api` paths keep
the JSON error envelope above.

## 6. Source access

If a future UI needs source snippets, expose a dedicated bounded endpoint rather than embedding full contents in Feature DTOs.

Potential contract:

```text
GET /assets/:id/snippet?startLine=10&endLine=40
```

Enforce limits.

