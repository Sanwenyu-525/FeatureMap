# MCP Usage (Phase 5 / AI Context Layer)

> MCP is a **thin adapter**. All context business logic lives in
> `@featuremap/context` (`buildFeatureContext`); the server simply maps
> tool arguments onto that API and shapes the response (MCP_SPEC §4).

## 1. Tools

Start the server with `featuremap mcp` (stdio). Tools available:

| Tool | Purpose |
| --- | --- |
| `list_features` | discover product capabilities (query / changedOnly filters) |
| `get_feature` | concise feature metadata + derived health |
| `get_feature_context` | primary context tool — budgeted, ranked sections (Phase 5 builder) |
| `get_related_code` | ranked code to read first: entry points + core + dependencies |
| `get_feature_dependencies` | DEPENDS_ON list (and optional dependents) |
| `get_change_impact` | features affected by the current Git diff / commit range |
| `get_related_tests` | tests associated with a feature (recommendation, not coverage claim) |
| `explain_relation` | full evidence chain behind one feature↔code relation |
| `get_affected_features` | (kept) current-diff impact, confidence-ranked |
| `get_applicable_instructions` | (kept) scoped repository rules |

## 2. Typical agent flow

```text
1. list_features                     → find the feature id
2. get_feature_context {featureId, budget: 8000}
3. get_related_code {featureId, task: "...your task..."}   → read these files
4. get_change_impact {}              → what else my change affects
5. explain_relation {featureId, target}  → when in doubt, ask "why"
```

## 3. Example calls

```jsonc
// Task-aware bounded context:
{ "featureId": "feature:login", "budget": 4000, "task": "fix session expiration" }

// Just the code to inspect:
{ "featureId": "feature:login", "maxItems": 12 }

// Impact of the current branch diff:
{ "range": "main..HEAD" }

// Chain behind one mapping:
{ "featureId": "feature:login", "target": "src/auth/auth-service.ts:login" }
```

## 4. Output contract

- Context tools return **paths, symbols, roles, tiers, scores, and
  evidence** — never `.env` contents, secrets, or unrelated source
  (MCP_SPEC §6).
- Every important mapping carries evidence
  (`analyzerId` / `origin` / `confidence`) so an agent can answer "why?".
- Unknown features return the stable envelope
  `{ "error": { "code": "FEATURE_NOT_FOUND", "message": "…" } }`.

## 5. Business logic boundary

```
MCP tool ──args──▶ buildFeatureContext(repoRoot, featureId, options)
                        │  context-resolver / ranker / budget / renderers
                        ▼
                  FeatureContext (projection of the graph)
```

The same API is shared by CLI (`featuremap context`), the future HTTP
endpoint, VS Code extension and GitHub integration — nothing is
MCP-specific except the transport.