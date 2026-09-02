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
| `scan.run` / `init.run` | maintenance (invalidates the index) |

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
