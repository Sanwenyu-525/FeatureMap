# Phase 5 Acceptance Checklist (AI Context Layer)

> Completion is judged against this checklist plus the automated test
> suite in `packages/context/tests/` (21 tests) and the MCP adapter
> tests in `packages/mcp/tests/`.

## 1. Functional acceptance (spec §13)

| # | Criterion | Status | Verified by |
| --- | --- | --- | --- |
| 1 | `featuremap context <feature>` generates a context | ✅ | manual CLI run on `test-fixtures/06-cross-feature` |
| 2 | Context derives from the existing Knowledge Graph (read-only projection) | ✅ | `context-resolver.ts` — no writes; resolver/ranker/budget are pure queries |
| 3 | No full repository source is copied into context | ✅ | entries carry `span` anchors, never file bodies |
| 4 | Markdown / JSON / Agent outputs | ✅ | `renderers/` + `--format` |
| 5 | Token budget support | ✅ | `--budget <tokens>`, 4000/8000/16000 tested |
| 6 | Task-aware context | ✅ | `--task` (rule-based boost only) |
| 7 | Core code survives small budgets | ✅ | S4 test: tier-1 anchors present at 4000/8000/16000 |
| 8 | Shared infrastructure does not pollute context | ✅ | S1/S3 tests: fan-in ≥ 3 down-weighted, never `owns` |
| 9 | Every important inference traces to evidence | ✅ | S1 “every entry carries evidence”; RHS of entries |
| 10 | Context API decoupled from CLI | ✅ | public `buildFeatureContext(repoRoot, featureId, options)` |
| 11 | MCP is only an adapter | ✅ | `packages/mcp` delegates to `@featuremap/context` |
| 12 | Automated tests cover ranking and budget | ✅ | ranking + budget + task-aware + JSON stability tests |

## 2. Data model (spec §1)

- `FeatureContext` includes feature summary, purpose, status, entry
  points, core code, related code (dependents), dependencies, tests,
  policies, constraints, recent changes, change risks, evidence. ✅
- Context is a projection — no bidirectional maintenance (resolver never
  writes). ✅

## 3. Ranking (spec §3)

- Priorities: ownership confidence, anchor, accepted relation, distance,
  dependency direction, recent change, tests, policies, shared-infra
  penalty. ✅ (`context-ranker.ts` + `CONTEXT_RANKING.md`)

## 4. Budget (spec §4)

| Section | Weight | Default (8000) |
| --- | --- | --- |
| Core Code (incl. entry points) | 40% | 3200 |
| Dependencies | 20% | 1600 |
| Tests | 15% | 1200 |
| Policies / Constraints | 10% | 800 |
| Recent Changes | 10% | 800 |
| Other (dependents 3% + risks 2%) | 5% | 400 |

Dynamic redistribution reallocates a satiated section's unused budget to
hungry sections, core first; anchors are always kept (documented
guarantee). ✅

## 5. Git / docs hygiene

| Item | Status |
| --- | --- |
| README updated with `featuremap context` | ✅ |
| AGENTS.md development constraints updated | ✅ |
| docs/ARCHITECTURE.md updated (context package) | ✅ |
| docs/DATA_MODEL.md §8 updated | ✅ |
| docs/MCP_SPEC.md updated | ✅ |
| docs/DEVELOPMENT_PLAN.md Milestone 18 added | ✅ |
| FeatureContext schema doc | ✅ `docs/context/FEATURE_CONTEXT_SCHEMA.md` |
| Context ranking doc | ✅ `docs/context/CONTEXT_RANKING.md` |
| MCP usage doc | ✅ `docs/context/MCP.md` |
| Six fixtures: simple-login / login-with-session / shared-infrastructure / large-feature / monorepo-feature / task-aware-login | ✅ `packages/context/tests/` |
| Whole-repo verification (`pnpm typecheck` + `pnpm lint` + `pnpm test`) | ✅ 201 tests pass |