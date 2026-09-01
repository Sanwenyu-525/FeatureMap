# MCP Specification

## 1. Goal

FeatureMap's MCP server gives coding agents focused, evidence-backed repository context organized by product feature.

It should reduce repeated repository exploration, not expose the entire repository blindly.

## 2. Transport

MVP priority:

1. stdio
2. local HTTP only if needed

## 3. Tools

### `list_features`

Purpose: discover available product capabilities.

Input:

```ts
{
  query?: string;
  changedOnly?: boolean;
}
```

Output:

```ts
Array<{
  id: string;
  name: string;
  description?: string;
  pattern: string;
  confidence: number;
}>;
```

### `get_feature`

Purpose: retrieve concise feature metadata.

Input:

```ts
{ featureId: string }
```

### `get_feature_context`

Purpose: primary agent context tool.

Input:

```ts
{
  featureId: string;
  include?: Array<
    'flow' |
    'code' |
    'apis' |
    'data' |
    'tests' |
    'documents' |
    'instructions' |
    'changes'
  >;
  maxItemsPerSection?: number;
}
```

Output should be bounded and ranked by relevance.

### `get_affected_features`

Purpose: analyze the current Git diff.

Input:

```ts
{
  base?: string;
  minimumConfidence?: number;
}
```

Output:

```ts
Array<{
  featureId: string;
  featureName: string;
  confidence: number;
  changedAssets: string[];
  reasons: string[];
}>;
```

### `get_applicable_instructions`

Purpose: retrieve scoped repository rules before modifying a feature.

Input:

```ts
{ featureId: string }
```

Output:

```ts
Array<{
  text: string;
  level: 'required' | 'recommended' | 'informational';
  source: string;
  scope?: string;
}>;
```

### Phase 5 context tools (adapter over `@featuremap/context`)

The server is a **thin adapter**: every context tool maps its arguments
onto `buildFeatureContext(repoRoot, featureId, options)` and shapes the
result. Business logic (resolve / rank / budget / render) stays in
`packages/context`. Docs: [docs/context/MCP.md](context/MCP.md).

| Tool | Input | Output |
| --- | --- | --- |
| `get_related_code` | `{ featureId, budget?, task?, maxItems? }` | ranked code: entry points + core + dependencies with evidence, plus `recommendedFilesToInspect` |
| `get_feature_dependencies` | `{ featureId, budget?, includeDependents? }` | `{ dependencies[], dependents[] }` |
| `get_change_impact` | `{ range?, minimumConfidence? }` | affected features with severity/reasons, shared infrastructure, recommended tests |
| `get_related_tests` | `{ featureId, budget? }` | `{ tests[] }` (a recommendation, never a coverage claim) |
| `explain_relation` | `{ featureId, target }` | evidence chain behind one relation |

Errors use the stable envelope `{ error: { code, message } }`
(e.g. `FEATURE_NOT_FOUND`).

## 4. Context ranking

`get_feature_context` should prioritize:

1. deterministic direct implementation evidence
2. manually confirmed mappings
3. high-confidence inferred mappings
4. directly applicable instructions
5. tests
6. current changes
7. recent supporting documents/history

Low-confidence peripheral files should not fill the context budget.

## 5. Explainability

Where practical, return a concise reason for important mappings.

Example:

```text
LoginForm.tsx → POST /api/auth/login → AuthController.login → AuthService.login
```

## 6. Safety/privacy

The MCP server must not automatically expose:

- `.env` contents
- secrets
- ignored credential files
- unrelated source contents

Feature context should prefer paths, symbols, summaries, and bounded snippets.

