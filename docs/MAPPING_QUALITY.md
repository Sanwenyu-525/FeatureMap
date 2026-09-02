# Mapping Quality (v0.7.1)

The Feature↔Code mapping benchmark — how FeatureMap turns "I think this
code belongs to this feature" into a measured, regressable number.

## Why this exists

FeatureMap ships four confidence surfaces: **Hover**, **CodeLens**,
**Live Impact** and **AI Context**. They are only as trustworthy as the
underlying feature↔code mapping. Mapping Quality replaces "it feels
right" with a golden corpus, a deterministic runner, metrics and CI
gates. **Precision > recall** — a wrong high-confidence relation costs
more than a missed one.

## Metrics

### Layer A — Mapping correctness

- **Precision** = TP / (TP + FP), where FP includes every candidate the
  engine emits that the corpus does not expect (precision-first: an
  unannotated candidate counts as a false positive and is reported as a
  ground-truth gap).
- **Recall** = TP / (TP + FN). Reported per relation (`OWNS` /
  `DEPENDS_ON`) and overall.

### Layer B — High-confidence safety (the primary gate)

- **High-confidence FP rate** = high-confidence mappings that are hard
  negatives (`must-not-high` / `notExpected`) ÷ all high-confidence
  mappings. High confidence = `CODE_INTELLIGENCE_POLICY.codeLensMinConfidence`
  — the same threshold CodeLens uses, never a second constant.

### Layer C — Structural noise

- **Shared-infra false promotion** = shared-infrastructure entities
  (tagged `shared-infra`) surfaced as high-confidence `OWNS`, ÷ all
  shared-infra entities.
- **Wrong ownership / ownership inflation** = relations that must not
  be owned (expected `DEPENDS_ON`, `notExpected` hard negatives)
  surfaced as high-confidence `OWNS`, ÷ the checked pool.

## Golden corpus

Ground truth lives as a colocated `mapping.expected.json` in each
fixture (`test-fixtures/01`–`06`).

```json
{
  "version": 1,
  "features": [
    {
      "id": "login",
      "expected": [
        { "target": { "type": "file", "path": "src/auth/auth-service.ts" }, "relation": "OWNS", "confidenceClass": "must-high" }
      ],
      "notExpected": [
        { "target": { "type": "symbol", "path": "src/shared/logger.ts", "symbol": "log" }, "relation": "OWNS", "confidenceClass": "must-not-high", "tags": ["shared-infra"] }
      ]
    }
  ],
  "entities": [
    { "target": { "type": "file", "path": "src/shared/logger.ts" }, "tags": ["shared-infra", "high-fanin"] }
  ]
}
```

Rules:

- **Stable locators only** — `path` + symbol `name`, never DB-generated
  ids, so the corpus survives rescans.
- **`confidenceClass`** — `must-high` (must reach Hover/CodeLens),
  `may-suggest` (candidate is enough), `must-not-high` (a hard
  negative; may exist as a low-confidence suggestion but must never be
  promoted).
- **`notExpected` is curated hard negatives only** — shared infra,
  cross-feature neighbors, same-name helpers, boundary files — not an
  exhaustive negative enumeration.
- **`entities`** tag shared-infrastructure / boundary files for the
  suppression metrics.
- **File targets match tolerant**: a file expectation matches the file
  candidate or any symbol candidate inside it; a symbol expectation
  matches its exact candidate or a qualified-id prefix (`path:name:*`).

## Running the benchmark

```bash
pnpm benchmark:mapping
```

`runMappingBenchmark(fixtureRoot)` performs a **fresh** scan into a
throwaway DB (never the fixture's leftover state), resolves ground
truth, compares predictions and returns metrics + a structured failure
list. `runBenchmarkSuite()` aggregates `test-fixtures/01`–`06`.
`docs/quality/mapping-baseline.json` records the aggregate baseline.

Every failure is structured (`fixture`, `type`, `featureId`, `target`,
`score`, `distance`, `fanIn`, `tags`) so a metric can be traced to the
exact evidence chain that produced it.

## CI gates

Hard gate (fails the benchmark):

- high-confidence FP rate **< 10%**

Soft report (recorded, not gated):

- overall precision / recall
- shared-infra false promotion
- cross-feature wrong ownership

## Deterministic vs semantic boundary

Deterministic rules are the product path (AGENTS.md §3.2). Fixable
without an LLM: fan-in noise, distance decay, ownership propagation,
direct vs transitive relations, shared-infra suppression, relation
precedence, ownership inflation.

An LLM is considered **only** when the failure classification shows a
meaningful share of `semantic-ambiguous` failures that graph topology /
fan-in / distance / naming rules cannot resolve — and even then it is
an auxiliary **ranking** signal, never the mapping authority, and is
validated offline against this benchmark before touching the pipeline.

## Failure classification

Failures are labelled (Stage 4):

- `deterministic-fixable` — a structural rule change can fix it
- `unsupported` — the engine does not yet emit this mapping
  (e.g. component-usage traversal to UI files)
- `annotation-error` — the corpus is under-annotated (a candidate is
  neither expected nor a hard negative)
- `semantic-ambiguous` — needs domain semantics (the LLM trigger)

## Current baseline

See `docs/quality/mapping-baseline.json` and `pnpm benchmark:mapping`.
As of v0.7.1 (Stage 6): high-confidence FP **0%**, shared-infra false
promotion **0%**, wrong ownership **0%**, overall recall ~98%,
precision ~76% (the residual precision cost is low-confidence noise
suggestions in the shared-infra fixture, per the precision-first
corpus definition).
