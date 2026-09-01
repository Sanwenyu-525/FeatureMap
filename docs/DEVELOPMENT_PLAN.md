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

## Milestone 9 — Incremental Scan (v0.2.4) — ✅ Complete

Status: complete. Cross-run per-file analysis cache
(`analysis_cache` table, packages/pipeline/src/incremental.ts) keyed
by `analyzer:version:file hash:file-set signature`; the TypeScript
analyzer skips file reads and AST walks on cache hits and replays the
stored per-file evidence (identical by construction — pinned by
tests). Added/removed files change the file-set signature and degrade
to full re-analysis, so stale cross-file edges are impossible.
`counts.changedFiles` / `counts.cachedFiles` and per-analyzer
`stats.cacheHits`/`cacheMisses` are surfaced through the scan output
and the CLI. Baseline (docs/reports/benchmark-v0.2.4.md): 1000 files —
full 1.7s, incremental 0.8s with 1 changed / 1000 cached, meeting the
v0.2 Performance Gate.

Goal: make rescans fast enough for daily use.

Implement:

- graph cache keyed by file hash (extends existing scanner hash cache)
- changed-file detection with partial graph rebuild
- ignore/generated-file rules feeding both scanner and graph

Exit criteria:

On a project with few changed files, an incremental rescan rebuilds
only affected graph nodes and produces identical evidence for
unchanged regions.

## Milestone 10 — Git Change Model (v0.3.0)

Goal: give commits and diffs a first-class, inspectable data model.
See ADR-0004 §1–§2.

Implement:

- unified change source model: working-tree / branch-diff /
  commit-range (single abstraction for CLI, API, MCP)
- diff hunk collection on demand via native git CLI — hunk headers
  and line ranges only, no diff content persisted (AGENTS.md §13)
- changed-symbol extraction: hunk line ranges ∩ symbol line spans,
  confidence 1.0; marked approximate when the range tip is not HEAD
  or the scan is stale
- configurable git log window (`git.logLimit`, default 200)

CLI:

```bash
featuremap git inspect <commit-ish>
```

Exit criteria:

A scripted fixture commit sequence produces deterministic changed
files and changed symbols, with symbol matches backed by evidence and
approximate matches labeled.

## Milestone 11 — Commit → Feature Impact (v0.3.1)

Goal: make impact answer "what did this commit (range) do to
features?".

Implement:

- `featuremap impact [<range>]` — no argument keeps today's
  working-tree + branch-diff behavior
- commit-range → changed symbols → feature traversal over
  `owns`/`DEPENDS_ON` relations (evidence-backed only, AGENTS.md §9)

CLI:

```bash
featuremap impact HEAD
featuremap impact HEAD~1..HEAD
featuremap impact main..HEAD
```

Exit criteria:

`impact HEAD~1..HEAD` on the fixture produces explainable affected
features — every feature in the output carries its evidence chain.

## Milestone 12 — Impact Severity & Shared Infrastructure (v0.3.2)

Goal: rank impact honestly instead of listing everything.

Implement:

- severity bands HIGH / MEDIUM / LOW (ADR-0004 §3) — rule-based,
  reasons attached, no opaque percentages (AGENTS.md §7)
- shared-infrastructure isolation: fan-in ≥ 3 features → separate
  "Shared Infrastructure" section, never attributed as feature impact
  (ADR-0004 §4)
- below-threshold evidence surfaced as explicit uncertainty

Exit criteria:

Changing `Logger` in the fixture does not attribute ownership impact
to every feature; changing `AuthService.login` yields Login as HIGH
with a symbol-level reason.

## Milestone 13 — Test Recommendations (v0.3.3)

Goal: turn impact into an actionable test plan.

Implement:

- "Recommended tests" section in impact output: ✓ (associated with a
  HIGH/MEDIUM affected feature) and ? (transitive/shared) statuses
  (ADR-0004 §5)
- sourced from the existing test-import → feature-closure
  association; labeled as recommendations, not coverage claims

Exit criteria:

The acceptance scenario fixture recommends the Login and Session
tests, and does not recommend unrelated feature tests.

## Milestone 14 — Feature Timeline (v0.3.4)

Goal: give features a time dimension in the UI.

Implement:

- per-feature history derived at query time (ADR-0004 §6): commits,
  contributors, churn, change kinds (feat/fix prefix)
- Changes tab in the Feature Detail page (Overview / Code /
  Dependencies / Changes / Tests)
- `GET /api/features/:id/changes` endpoint

Exit criteria:

A feature page shows a commit timeline with contributors and churn
for the configured log window, each entry traceable to its commit and
feature mapping evidence.

## Phase 3 acceptance scenario

Fixture: a Login feature (LoginPage, LoginForm, AuthService.login,
UserRepository) plus Session and a shared Logger. One commit changes
`AuthService.login`, `TokenService.create`, and `Logger`. Then:

```bash
featuremap impact HEAD~1..HEAD
```

must yield:

```text
Affected Features

HIGH
  Login       — AuthService.login changed directly (symbol-level)

MEDIUM
  Session     — TokenService is a dependency (1 hop)

Shared Infrastructure
  Logger      — depended on by 4+ features, not attributed

Recommended Tests
✓ auth/login.test.ts
? session/token.test.ts
```

Not acceptable: Register / Profile / Checkout / Settings appearing
because they import shared code. If this scenario passes stably,
Phase 3 delivers its intended value step over v0.2.

Phase 4 (GitHub/GitLab PR Intelligence) starts only after the local
loop above proves daily value — automating output nobody reads
locally is not a goal.

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

Status: the Blocker checklist is fully verified (2026-09-01, see
`docs/reports/v0.2-release-gate-2026-09-01.md`), the §5 end-to-end
scenario and §7 dogfooding pass, and the six-fixture Quality Gate
suite (01–06, including the shared-infrastructure fixture 04) is in
place with fixture-level assertions pinning shared-infra behavior.

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

