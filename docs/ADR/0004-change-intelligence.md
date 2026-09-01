# ADR-0004: Change Intelligence — commit ranges, changed symbols, severity bands (v0.3)

- Status: Accepted

- Scope: Phase 3 (Milestones 10–14, v0.3.0–v0.3.4)

## Context

v0.2 delivered the static map: symbol-level code graph
(CONTAINS/CALLS/REFERENCES/IMPORTS), anchor-driven candidates with
`owns`/`DEPENDS_ON` separation, review workflow, incremental scan.
`featuremap impact` (Milestone 4) already answers "what does my current
working tree / branch diff touch", but only at file granularity:

- the change set is limited to the `WORKING_TREE` and `BRANCH_DIFF`
  pseudo-SHAs persisted by the scan — no commit-range input
  (`HEAD~1..HEAD`, `main..HEAD`);

- the git analyzer records name-status per commit but no diff hunks,
  so impact cannot see *which symbols* changed;

- confidence output is two-tier (direct 1.0 / transitive 0.8) with no
  severity model and no shared-infrastructure handling — changing
  `Logger` today attributes 0.8-impact to every importing feature;

- features have no time dimension: no commit history, contributors,
  or change timeline.

Phase 3 ("Change Intelligence", not "Git integration") upgrades the
product from "which code belongs to this feature" to "what does a code
change do to features": commit/diff → changed symbols → affected
features → severity, tests, review context. Git is only the data
source; the product value is deriving feature-level impact from code
change.

## Decisions

### 1. Unified change source model

All change consumers (impact CLI, API, MCP, timeline) read one
abstraction:

```text
ChangeSource = working-tree | branch-diff | commit-range <from>..<to>
```

- `featuremap impact` gains an optional `<range>` argument;
  no argument preserves today's behavior (working tree + branch diff).

- `featuremap git inspect <commit-ish>` exposes the raw change model
  (commit metadata, changed files, changed symbols) for auditability.

- Diff hunks are computed **on demand** via the native git CLI
  (`git diff` / `git show`) and are **not persisted** — only hunk
  headers (file, old/new line ranges, change type) are used. Full diff
  content is never stored or logged (AGENTS.md §13).

### 2. Changed-symbol extraction is the v0.3.0 core deliverable

Diff hunk line ranges are intersected with `symbols.startLine/endLine`
already stored by the scan:

```text
hunk new-side lines ∩ symbol line span → changed symbol (confidence 1.0)
```

This is the phase's pivotal capability: without it, a comment tweak
and a rewrite of `AuthService.login` are indistinguishable. It feeds
severity bands (Decision 3) and the acceptance scenario.

Precision caveat, documented deliberately: symbol line spans come
from the latest scan (working tree at HEAD). Extraction is **exact**
when the range tip is HEAD and the scan is fresh; for older ranges
symbol positions may have drifted — such matches are marked
approximate in metadata, and impact falls back to file-level reasons.

### 3. Severity bands, not percentages

Impact output uses three explainable bands; opaque percentages like
`94%` are explicitly rejected (AGENTS.md §7, §9):

```text
HIGH   — a changed symbol is owned by the feature (symbol-level match)
MEDIUM — the feature DEPENDS_ON a changed symbol/file (1 hop), or a
         changed file is in the closure without a symbol-level match
LOW    — 2+ hops from the change, above the surface threshold
```

Band assignment is rule-based and every assignment carries its reasons
and evidence chain. Below-threshold evidence is excluded from the
ranked list and surfaced as explicit uncertainty, never silently
dropped.

### 4. Shared infrastructure is isolated, not attributed

When a changed symbol/file has fan-in ≥ 3 features depending on it
(the same threshold semantics as the ADR-0003 §5 fan-in penalty), it
is **not** attributed as feature impact. It is listed in a separate
"Shared Infrastructure" section with its dependent count. This
prevents the `Logger changed → 47 features impacted` failure mode and
keeps the ranked list meaningful.

### 5. Test recommendations, not coverage claims

`impact` output gains a "Recommended tests" section with two statuses:

```text
✓ — test associated with a HIGH/MEDIUM affected feature
    (existing test-import → feature-closure association)
? — test associated with transitively / shared-affected code
```

The feature↔test association built by feature discovery (test files
importing feature-closure files) is the only source in v0.3; naming
conventions and git co-change stay future enhancement candidates. The
section is labeled "recommended" — FeatureMap does not claim complete
impact analysis of test coverage.

### 6. Feature timeline is derived, not materialized

Feature history is computed at query time by mapping the scan's git
log window through the same impact rules (commitFiles + membership +
Decision 3 bands):

```text
Feature → commits, contributors, churn (files/symbols touched),
          change kinds (feat/fix via conventional-commit prefix, 1.0)
```

No new feature×commit relation table is introduced in v0.3 —
derivation keeps a single source of truth and avoids stale
materialization; persisting a mapping is a documented optimization
path if profiling demands it. The git log window becomes configurable
(`git.logLimit` in `featuremap.yaml`, default 200; today's hardcoded
50 is too short for 30-day timelines on active repos). Hotspot /
churn analytics are deferred until the data accumulates.

## Consequences

- Schema: one additive table (`commit_symbols`: commitSha, symbolId,
  changeType) for on-demand persistence of extraction results when a
  range is analyzed; `commits`/`commit_files` continue to serve the
  timeline.

- API: `GET /api/changes` gains a `range` query parameter and severity
  in its response; Feature Detail gains a changes/timeline endpoint.

- MCP: `get_affected_features` gains severity bands and the
  shared-infrastructure grouping.

- CLI: `featuremap impact [<range>]`, `featuremap git inspect <commit-ish>`.

- Fixtures: the phase acceptance scenario (Login / Session / Token /
  Logger commit script) becomes a scripted-commit fixture with
  expected HIGH/MEDIUM assignments and shared-infrastructure
  isolation.

- Out of scope for v0.3: GitHub App / PR bot / CI comments. The order
  is deliberate — prove the local loop (`featuremap impact main..HEAD`)
  is worth running before automating its output anywhere. Phase 4
  (GitHub/GitLab PR Intelligence) builds on this foundation once the
  local output is validated.

