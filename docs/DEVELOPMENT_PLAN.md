# Development Plan

## Milestone 0 — Repository bootstrap — ✅ Complete

Status: completed (`d3e43a9`). pnpm workspace, TypeScript configs, lint/typecheck/test setup, package boundaries, SQLite/Drizzle bootstrap, CLI shell with `init`/`doctor`, fixture strategy under `test-fixtures/`.

Goal: establish architecture and developer workflow.

Deliverables:

- pnpm workspace
- TypeScript configs
- lint/typecheck/test setup
- package boundaries
- SQLite/Drizzle bootstrap
- CLI shell
- fixture repository strategy

Exit criteria:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

all run successfully.

## Milestone 1 — Repository Intelligence — ✅ Complete

Status: completed (`b4a2409`). Scanner (ignore rules, hashing, document discovery, technology detection), analyzer platform with failure isolation, TypeScript/Express/NestJS/Prisma/Markdown/Git analyzers, evidence persistence, `featuremap scan --json`.

Goal: generate deterministic repository evidence.

Implement:

- repository root detection
- ignore rules
- file inventory
- file hashing/cache
- Git branch/base detection
- Git diff and commit metadata
- TypeScript symbol/import extraction
- Markdown/document discovery
- NestJS/Express route extraction
- Prisma model extraction

CLI:

```bash
featuremap scan --json
featuremap doctor
```

Exit criteria:

A fixture repo produces stable JSON evidence for files, symbols, routes, documents, and Git changes.

## Milestone 2 — Feature Discovery — ✅ Complete

Status: completed (`c71f8e2`). Deterministic clustering (endpoint anchors → evidence closure), pattern classification, explainable health derivation, document mapping, `featuremap feature <name>`. LLM semantic naming remains an optional future enhancement; the deterministic baseline is the product path (AGENTS.md §3.2).

Goal: convert evidence into useful feature groups.

Implement:

- feature candidate clustering
- semantic feature naming
- feature grouping
- pattern classification
- confidence model
- feature health derivation
- document/instruction mapping

CLI:

```bash
featuremap feature login
```

Exit criteria:

Representative fixture repos produce understandable features with explainable mappings.

## Milestone 3 — Local Web UI — ✅ Complete

Status: completed (`5c1273f`, `323c2c6`). Fastify API serving consumer DTOs, React/Vite app with Overview/Features/Feature Detail/Changes pages, @xyflow product-flow visualization with confidence-differentiated edges and a "Why?" evidence panel, static hosting + SPA fallback in `featuremap dev`, Playwright E2E covering the five acceptance flows.

Goal: make FeatureMap usable as a Swagger-like local application.

Implement pages:

1. Overview
2. Features
3. Feature Detail
4. Changes

Implement:

- Fastify local API
- React/Vite app
- Feature flow visualization
- evidence "Why?" view
- health states
- branch impact view

CLI:

```bash
featuremap dev
```

Exit criteria:

A developer can answer the five MVP acceptance questions through the browser.

## Milestone 4 — Change Impact — ✅ Complete

Status: completed (`7d79140`). Working-tree + branch-diff change set, evidence-backed reverse traversal (direct membership 1.0, transitive IMPORTS 0.8), confidence ranking, relevant tests/docs, documentation-drift warnings, `featuremap impact` and `GET /api/changes`.

Goal: make FeatureMap useful in everyday coding flow.

Implement:

- diff → changed file mapping
- changed symbol extraction when available
- feature impact traversal
- confidence ranking
- relevant tests/docs/rules
- potential documentation drift warnings

CLI:

```bash
featuremap impact
```

Exit criteria:

Impact output is useful on representative feature branches without overwhelming false positives.

## Milestone 5 — MCP — ✅ Complete

Status: completed (`9119a69`). stdio MCP server exposing all five tools with bounded, ranked context output; `featuremap mcp` command.

Goal: serve FeatureMap context to coding agents.

Expose:

```text
list_features
get_feature
get_feature_context
get_affected_features
get_applicable_instructions
```

Exit criteria:

A coding agent can resolve a feature-level task using FeatureMap context while reading fewer unrelated files than a naive exploration baseline.

## Recommended build order inside Milestone 1

1. filesystem scanner
2. Git analyzer
3. SQLite schema
4. TypeScript analyzer
5. Markdown analyzer
6. Express/NestJS routes
7. Prisma
8. incremental cache

## Post-MVP candidates

Do not start until MVP usage validates demand:

- GitHub App / PR impact comments
- VS Code / Cursor extension
- GitLab
- SaaS team workspace
- multi-repo features
- Java/Python/Go analyzers
- runtime traces
- screenshot/product UI evidence
- Rust indexer

