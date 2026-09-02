# FeatureContext Schema (Phase 5 / AI Context Layer)

> Schema version: `1` — `packages/context/src/types.ts` is the normative source.

## 1. What a FeatureContext is

A `FeatureContext` is a **read-only projection** of the Feature Knowledge
Graph, computed at query time by `buildFeatureContext(repoRoot,
featureNameOrId, options)` (in `@featuremap/context`). It is **never a
second source of truth**: no context build writes a single graph row.

```text
Feature Knowledge Graph (SQLite)
  └─ resolve (context-resolver)  → raw facts
  └─ rank   (context-ranker)     → tiers + task-aware order
  └─ budget (context-budget)     → importance-weighted token selection
  └─ render (markdown / json / agent)
```

## 2. Top-level shape

| field            | type                  | description                                                                    |
| ---------------- | --------------------- | ------------------------------------------------------------------------------ |
| `schemaVersion`  | `'1'`                 | Bump on **breaking** JSON changes. Additive changes never bump it.             |
| `generatedBy`    | object                | builder identity, version, request format, options, timestamp.                 |
| `feature`        | object                | id, name, description?, pattern, status, confidence, health?.                  |
| `purpose`        | string?               | deterministic one-liner (description, else pattern + entry points).            |
| `summary`        | string?               | one-line counts of the included projection.                                    |
| `entryPoints`    | `CodeEntry[]`         | API / CLI entry assets. Always Tier 1.                                         |
| `coreCode`       | `CodeEntry[]`         | the feature's own implementation (owns relations + data entities).             |
| `dependencies`   | `CodeEntry[]`         | what the feature DEPENDS\_ON.                                                  |
| `dependents`     | `CodeEntry[]`         | files outside the feature that import its core (`IMPORTS`).                    |
| `tests`          | `CodeEntry[]`         | test assets associated with the feature.                                       |
| `policies`       | `PolicyEntry[]`       | feature-scoped repository instructions.                                        |
| `constraints`    | `PolicyEntry[]`       | subset of policies with `level = required`.                                    |
| `recentChanges`  | `RecentChangeEntry[]` | commits touching owned paths (derived at query time).                          |
| `changeRisks`    | `RiskSignal[]`        | deterministic risk bands from recent changes.                                  |
| `evidence`       | `ContextEvidence[]`   | consolidated, deduplicated provenance.                                         |
| `budget`         | object                | requested, estimatedTotal, allocation, dropped, overBudget, exhaustedSections. |
| `task`           | object?               | task text, extracted terms, boostsApplied (task-aware only).                   |
| `truncationNote` | string?               | explicit note when budget dropped entries — never silent.                      |

### CodeEntry

```ts
{
  id: string;            // candidate targetId / asset id / synthetic key
  kind: string;          // file | symbol | endpoint | cli_command | data_entity | test
  file?: string;
  name?: string;         // symbol name when symbol-level
  symbolType?: string;   // function / class / method / component / …
  span?: string;         // `path:startLine-endLine` (code anchor, NO source body)
  role: 'anchor' | 'owns' | 'DEPENDS_ON';
  status?: 'declared' | 'suggested' | 'accepted';   // rejected never appears
  isAnchor: boolean;
  distance: number;      // relational hops from nearest anchor
  fanIn: number;         // whole-repo in-degree
  score: number;         // composite deterministic ranking score
  tier: 1 | 2 | 3 | 4;
  confidence: number;
  relations: string[];   // human-readable relation notes
  evidence: ContextEvidence[];
  estimatedTokens: number;
  recent?: boolean;
  taskMatched?: boolean;
}
```

## 3. JSON stability rules

- Field order is fixed; fields are only ever **added**, never renamed or
  removed, while `schemaVersion` is `1`.

- `generatedBy.timestamp` is build metadata and is excluded from
  deterministic comparisons.

- IDs are stable across runs for the same graph: candidate ids, asset
  ids, and synthetic keys (`F:<path>` / `S:<path>:<name>` /
  `dependent:<file>`) are derived from graph rows.

## 4. Purpose and summary derivation

- `purpose`: explicit `feature.description` wins; otherwise
  `"{name}（{pattern}）：{first 3 entry point names}"`.

- `summary`: `"{name}：{n} 入口，{n} 核心，{n} 依赖，{n} 测试，{n} 下游，
  {n} 约束，{n} 近期提交（预算 X tokens，实际估算 Y）"`.

## 5. Deliberately absent

- **Source bodies**: a context guides code discovery; it does not
  duplicate the repository. Entries carry `span` line anchors; the agent
  reads the files itself.

- **Rejected relations**: `rejected`/`superseded` candidates never enter
  a context (spec §12: “rejected relation 不进入 Context”).

- **LLM facts**: everything in this model comes from deterministic graph
  rows; `origin` distinguishes `deterministic` vs `semantic` vs `manual`.

