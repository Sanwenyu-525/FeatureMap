# IDE RPC & Code Intelligence (Phase 6 / v0.6.2)

The VS Code extension (`apps/vscode-extension`) is a pure adapter
(ADR-0008 §2). It spawns `featuremap ide`, a headless service speaking
newline-delimited JSON-RPC 2.0 over stdio (`packages/ide`), and owns
the process lifecycle. Business rules live in
`packages/pipeline/src/code-intelligence`; the extension never queries
SQLite, computes Feature relations, or ranks candidates.

## RPC surface

`repoRoot` is implied by the spawned process cwd. Line numbers are
**1-based on the wire**; the extension converts 0-based `Position`s
only in `src/providers/position-symbol.ts` (plan §A1).

| Method | Purpose |
| --- | --- |
| `project.status` | initialized/scanned state, counts |
| `features.list` | feature summaries (optional `query` filter) |
| `features.get` | feature detail incl. confirmed symbol assets + location |
| `symbols.resolve` | editor hint (`SymbolRef`) → stored symbol |
| `code.relatedFeatures` | Symbol → Related Features (ranked, compact) |
| `code.intelligence` | compact Hover payload (feature, deps, tests) |
| `code.documentIntelligence` | one batch call per document for CodeLens |
| `code.explainRelation` | evidence chain behind one relation |
| `impact.refresh` | save-triggered orchestration: incremental scan → `analyzeImpact(WORKING_TREE)` → cached snapshot (invalidates the code-intelligence index) |
| `impact.current` | cheap read of the last snapshot — never triggers analysis |
| `suggestions.list` | Review inbox — `status = suggested` only, ranked deterministically |
| `review.verdict` | wraps `setVerdict`; optimistic `expectedFingerprint` concurrency check (plan §15) |
| `review.explain` | evidence chain for a file or symbol candidate |
| `diagnostics.drift` | deterministic drift over indexed state — never scans (plan §17) |
| `scan.run` / `init.run` | maintenance (invalidates the index) |

`impact.refresh` is the **only** save-triggered entry point; the
extension never calls `scan.run` + `analyzeImpact` itself (v0.6.3
plan §A2). `savedFiles` is an incremental-scan hint; the impact scope
is always the whole working tree.

`SymbolRef`:

```ts
interface SymbolRef {
  filePath: string;
  name?: string;
  startLine?: number; // 1-based
  endLine?: number;
}
```

## Relation semantics

- Canonical Feature relations: `OWNS` / `DEPENDS_ON` only.
- Code-graph edges (`CALLS` / `REFERENCES` / `CONTAINS`) are evidence
  types, never promoted to Feature relations directly (layered, plan
  §A4).
- Sources for Symbol → Feature: `feature_assets` (confirmed OWNS),
  `feature_candidates` with `declared`/`accepted` status (confirmed),
  and `suggested` candidates that clear the confidence bar **and** carry
  evidence. `rejected` / `superseded` never surface.
- Ranking is deterministic: confirmed OWNS → confirmed DEPENDS_ON →
  accepted → declared → high-confidence suggested; ties by score DESC,
  distance ASC, fanIn ASC, featureId ASC.

## Confidence policy (`packages/pipeline/src/code-intelligence/policy.ts`)

```ts
CODE_INTELLIGENCE_POLICY = {
  hoverMinConfidence: 0.85,
  codeLensMinConfidence: 0.9,
  relatedFeaturesMinConfidence: 0.8,
  maxHoverFeatures: 2, maxHoverDependencies: 3, maxHoverTests: 2,
  highFanInThreshold: 8,
}
```

High fan-in `DEPENDS_ON` relations (shared-infrastructure-prone) require
a higher score to enter Hover/CodeLens — driven by graph metrics, never
hardcoded names (plan §15).

## SymbolFeatureIndex

In-memory **read model** (never a second source of truth): `bySymbolId`
(relations) + `symbolsByFile` (ranges for line fallback). Built lazily
per repository, invalidated whole-repository on `scan.run` (plan §5.5 —
no row-level cache sync until profiling proves a bottleneck).

## Live Change Impact (v0.6.3)

- Extension only listens to `onDidSaveTextDocument` (never
  `onDidChangeTextDocument`), aggregates saved paths into a Set, waits
  400ms, and issues **one** `impact.refresh`; a single in-flight
  refresh never drops saves that arrive meanwhile (plan §9).
- Status bar: `FeatureMap · N affected` (N = `summary.affectedFeatureCount`,
  exactly `affectedFeatures.length`), `FeatureMap: analyzing…` while
  refreshing, `FeatureMap` when 0 affected, error state on failure.
  No auto-popups (plan §43).
- Current Change Impact TreeView renders the cached snapshot only:
  HIGH → MEDIUM → LOW groups, each Feature with Why (reasons verbatim
  from `analyzeImpact`), Tests and Documents. Clicking a Feature opens
  it; Tests/Documents open the file.
- Manual `Refresh Current Change Impact` covers Git checkouts and
  external edits; it never falls back to full filesystem watching.

## Review & Diagnostics (v0.6.4)

- Review runs entirely in the IDE: `Review Suggested Relations` opens a
  QuickPick of `suggestions.list`; each relation has
  Accept / Reject / Explain / Open Target. The only verdict writer is
  `setVerdict` (plan §1.1), with an optimistic fingerprint check so a
  stale selection is never applied.
- Drift uses the **shared** `detectDrift` (extracted from the PR
  report) — the PR and the IDE can never diverge (plan §1.2). It is
  always detect → suggest: never auto-accept/reject, and it only
  surfaces deterministic `relation_broken` / `new_candidate`.
- Problems integration: `relation_broken` → Warning, `new_candidate` →
  Information, source `FeatureMap`, code = drift type; 1-based → 0-based
  only in the adapter; the collection is replaced (resolved drift
  clears). `diagnostics.drift` never scans — it refreshes after
  connect / impact.refresh / scan / init / verdict.
- Drift status bar: `FeatureMap ⚠ N issues` (N from the DTO), hidden at
  0, click focuses Problems. No toasts, no Review CodeLens, no
  auto-popups (plan §30–§31).

## Adapter boundary (extension)

- Position → Symbol: `vscode.executeDocumentSymbolProvider`, smallest
  containing range; fallback to `{ filePath, startLine }` line matching.
- Hover renders a compact summary (`hover-markdown.ts`); full
  exploration lives in Show Related Features / Explain Relation.
- CodeLens issues one `code.documentIntelligence` per document — never
  N+1 — and only confirmed / high-confidence relations reach a lens.
- Explicitly out of scope: custom LSP, own TS parsing, LLM symbol
  mapping, deep real-time traversal, new symbol→feature tables, heavy
  WebViews (plan §19).
