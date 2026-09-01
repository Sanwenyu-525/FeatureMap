# ADR-0005: PR Intelligence — local feature-aware PR report (v0.4.0)

- Status: Accepted

- Scope: Phase 4 (v0.4.0) — `featuremap pr`

## Context

Phase 3 proved the local loop: `featuremap impact main..HEAD` derives
feature-level impact from a commit range with severity bands, shared-
infrastructure isolation, test recommendations and documentation-drift
warnings (ADR-0004). Phase 4 moves that output into the team workflow,
starting with GitHub. But the plan is deliberately staged
(ADR-0004 Consequences; DEVELOPMENT_PLAN.md Phase 4 note): **analysis
first, transport second**. Automating output nobody reads is not a
goal, so v0.4.0 builds the *local* feature-aware PR report and leaves
GitHub Check / comment / App to later milestones.

## Decisions

### 1. A PR is a change source, not a new concept

`featuremap pr` takes the same `<range>` argument as `impact`
(`main..HEAD`, `HEAD`, or the working tree + branch diff when
omitted) and reuses `analyzeImpact` unchanged. A GitHub PR is just a
named range in the transport layer; the analysis never knows about
GitHub.

### 2. Risk is an explainable band, not a percentage

Risk is expressed as HIGH / MEDIUM / LOW (consistent with ADR-0004
§3; AGENTS.md §7 rejects opaque percentages like `78/100`). A rule
table contributes explainable increments — direct core change (+1),
public API / route / CLI entry change (+1), shared dependency change
(+1), database schema change (+1), related tests unchanged (+1),
many features affected (+1) — with every contribution carrying its
reason. Bands: ≥ 4 → HIGH, 2–3 → MEDIUM, ≤ 1 → LOW. The increments
are transparency aids for the band, never a score.

### 3. Test coverage is "potential missing coverage", never "tests missing"

The report marks each recommended test as changed (✓) or unchanged
(⚠ potential missing coverage). The wording is deliberate: a test
change is not always required, and FeatureMap does not claim complete
coverage analysis (ADR-0004 §5). The signal only fires for a feature
that actually has associated tests.

### 4. Mapping drift is deterministic, file-granular, and detect → suggest

Drift detection uses two deterministic kinds:

- `relation_broken` — an accepted/declared relation whose file was
  deleted or renamed in the diff. The mapping cannot still hold.
- `new_candidate` — a changed symbol inside a feature-owned file that
  is not yet an accepted/declared relation. Detect → suggest only;
  creation stays a human decision (ADR-0002 §2).

Precision caveat, documented deliberately: symbol-level "deleted
accepted symbol" cannot be proven from the scan DB, because the scan
reflects the PR tip — a symbol removed by the PR is not in the DB
(ADR-0004 §2). So drift is file-granular plus new-symbol suggestions;
FeatureMap does not claim to prove which specific symbol vanished from
a modified file.

### 5. No schema change

v0.4.0 reuses the existing evidence, assets, feature_assets and
feature_candidates tables. `ImpactResult` gains an additive
`changedSymbols` field (already computed internally) so the drift
layer can compare diff symbols against confirmed relations.

## Consequences

- CLI: `featuremap pr [<range>] [--json]` (apps/cli/src/index.ts).
- Analysis: `packages/pipeline/src/pr-report.ts` — `buildPrReport`
  layers risk band, test coverage and mapping drift over impact.
- Fixtures: `packages/pipeline/tests/pr-report.test.ts` — scripted
  commit scenarios for the acceptance case and the drift case.
- Out of scope for v0.4.0: GitHub Action / Check / comment, GitHub
  App, feature policies, Feature Ownership, CI gates. These follow
  once the local report is validated in daily use.
