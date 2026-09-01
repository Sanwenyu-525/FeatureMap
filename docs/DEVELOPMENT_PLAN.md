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

## Milestone 6 — Code Graph (v0.2.0) — ✅ Complete

Status: complete. TypeScript analyzer emits CONTAINS (file→symbol,
class→method), resolved CALLS (symbol→symbol, direct 1.0 / method
0.9), JSX component usage as REFERENCES (`metadata.usage: 'component'`)
plus IMPORTS; `featuremap inspect <file>` reports the evidence-backed
graph neighborhood.

Goal: answer "how is the code related?" at symbol level. See ADR-0003.

Implement:

- `CONTAINS` edges (file→symbol, class→method)
- `CALLS` edges (resolved call expressions, symbol→symbol)
- React component usage edges (JSX → imported component symbol)
- `featuremap inspect <file>` — exports, imports, calls, called-by, references

Exit criteria:

A fixture file's inspect output deterministically lists its graph
neighborhood with evidence for every edge.

## Milestone 7 — Feature Anchors & Candidate Scoring (v0.2.1–v0.2.2) — ✅ Complete

Status: complete. `FeatureAnchor` type in core; declared anchors via
`featuremap.yaml` `features.anchors`; anchor-driven expansion
(packages/pipeline/src/candidates.ts) with depth ≤ 3, distance decay,
fan-in penalty, owns/DEPENDS_ON separation and explainable evidence
chains; candidates persisted as declared/suggested in
`feature_candidates` with verdict-preserving rescans; `featuremap scan
<featureId>` prints ranked candidates. Known calibration item: the
fan-in penalty does not bind at single-feature fixture scale — it is
quantified by the shared-infrastructure fixtures (04–06) of the
Quality Gate suite.

Goal: expand features from anchors with scored, explainable candidates.

Implement:

- `FeatureAnchor` type (file / symbol / route / component) plus manual
  anchor declaration for non-endpoint features
- graph traversal from anchors (depth ≤ 3)
- rule-based scoring: anchor bonus, direct call/import/component usage,
  distance decay, fan-in penalty for shared infrastructure
- `owns` vs `DEPENDS_ON` separation (ADR-0003 §3)
- candidate relations persisted as `suggested`

CLI:

```bash
featuremap scan <featureId>
```

Exit criteria:

Fixture repos produce scored candidates where shared infrastructure
(logger, config) does not surface as feature ownership.

## Milestone 8 — Review Workflow (v0.2.3) — ✅ Complete

Status: complete. `featuremap accept|reject <featureId> <target>`
(packages/pipeline/src/review.ts) with precise error envelopes;
`featuremap explain` renders the full evidence chain behind a score;
Suggestions panel with accept/reject in the Feature Detail page
backed by `POST /api/features/:id/candidates/verdict`; verdicts
persist across rescans while their evidence fingerprint is stable, and
changed/vanished chains mark rows `superseded` for re-review
(docs/releases/v0.2-acceptance.md §4). Deferred: accepted candidates
feeding the derived feature-health dimensions (P2, needs an
explainable rule before wiring).

Goal: close the loop between suggestions and human judgment.

Implement:

- relation status state machine: declared / suggested / accepted /
  rejected (ADR-0003 §4)
- `featuremap accept|reject <featureId> <target>`
- `featuremap explain <featureId> <target>` — evidence chain with
  confidence
- Suggestions panel in the Feature Detail page (accept/reject from UI)
- rejected relations stay suppressed across rescans unless their
  evidence chain changes

Exit criteria:

A rejected shared-utility candidate never reappears in suggestions;
an accepted candidate survives rescans and counts toward feature
health.

## Milestone 9 — Incremental Scan (v0.2.4)

Goal: make rescans fast enough for daily use.

Implement:

- graph cache keyed by file hash (extends existing scanner hash cache)
- changed-file detection with partial graph rebuild
- ignore/generated-file rules feeding both scanner and graph

Exit criteria:

On a project with few changed files, an incremental rescan rebuilds
only affected graph nodes and produces identical evidence for
unchanged regions.

## Mapping quality (cross-cutting, starts with Milestone 6)

Fixture repositories with ground-truth feature mappings
(expected/notExpected symbol lists) measured as Precision/Recall.
Precision first (ADR-0003 §5): target > 80% precision on core features
before optimizing recall.

## v0.2 Release Gate

Release is judged against `docs/releases/v0.2-acceptance.md`, not by
milestone completion alone. It defines the Blocker checklist (anchors,
code graph, evidence, review loop, resolution, incremental scan), the
Quality Gate thresholds (core fixtures Precision ≥ 85% / Recall ≥ 70%,
all-fixture average Precision ≥ 80% / Recall ≥ 65%, shared-infra
false-positive rate < 10%), the Performance Gate (baseline-first,
calibrated), the end-to-end acceptance scenario, and the usability /
dogfooding checks.

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

