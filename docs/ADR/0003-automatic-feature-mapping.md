# ADR-0003: Anchor-driven candidate mapping with human review (v0.2)

- Status: Accepted
- Scope: Phase 2 (Milestones 6–9, v0.2.0–v0.2.4)

## Context

The MVP discovers features deterministically from endpoint anchors and
IMPORTS closure (ADR-0002). Dogfooding on the FeatureMap repository
itself showed the limits of that closure:

- core library features (scanner, pipeline, impact, mcp) have no HTTP
  endpoints and stayed invisible;
- feature boundaries are file-granular: two features sharing one file
  cannot be separated (e.g. `login()` and `logout()` in `auth.ts`);
- there is no write channel to say "this candidate is wrong" —
  suggested context either stays or disappears entirely.

The phase-2 proposal (docs/DEVELOPMENT_PLAN.md Milestones 6–9)
introduces a symbol-level code graph, anchor-driven candidate
generation, and a human review loop. This ADR fixes the architectural
decisions before implementation.

## Decisions

### 1. Anchors are generalized; automatic discovery stays

A `FeatureAnchor` is `{ type: 'file' | 'symbol' | 'route' | 'component', target: string }`.

- Endpoint-derived route anchors (ADR-0002) remain the automatic anchor
  source and keep precedence.
- Users may declare additional file/symbol anchors for features that
  have no HTTP surface (CLI commands, workers, core libraries).
- Automatic feature discovery (clustering) and anchor-driven candidate
  expansion are complementary: discovery answers "what features
  exist", anchors answer "where does this feature end".

### 2. Symbol-level code graph

The TypeScript analyzer gains three deterministic edge families beyond
IMPORTS:

- `CONTAINS` — file→symbol and class→method structural containment,
  confidence 1.0;
- `CALLS` — resolved call expressions, symbol→symbol. Direct calls to a
  local or named-imported symbol are deterministic (1.0). Method calls
  resolved through an imported binding's file are strong inference
  (0.9) because no type checker runs;
- component usage — JSX usage of an imported component emits
  `REFERENCES` with `metadata.usage: 'component'` (deterministic via
  import resolution).

No type checker is introduced in v0.2; call resolution is
specifier-based and therefore explainable. If precision suffers, a
ts-morph program pass is the documented upgrade path, not a rewrite.

### 3. `owns` and `dependsOn` are separate relations

Traversal beyond the ownership threshold must not be flattened into
feature ownership. A feature **owns** a symbol only when the evidence
chain from an anchor is short and strong; symbols reached transitively
through owned symbols are recorded as `DEPENDS_ON` with their evidence
chain, not as ownership. This prevents the "everything belongs to
Login" graph pollution that unbounded closure causes.

### 4. Relation status state machine

Every feature↔code candidate relation carries a status:

```text
declared  — user-written (or endpoint-derived anchor), highest authority
suggested — produced by graph traversal + scoring
accepted  — user confirmed a suggestion
rejected  — user explicitly denied a suggestion
```

Manual correction outranks any inference. Rejected relations are
persisted and suppressed from future suggestion output unless the
underlying evidence chain changes (new direct call, new import).

Known limitation (v0.2, non-blocker): verdicts record a relation
fingerprint (evidence-chain hash). When code changes make the chain
essentially new (e.g. a rejected dependency is renamed and re-wired),
the rejection is surfaced as `superseded` for re-review instead of
silently suppressing a genuinely new relation. Automated semantic
equivalence of relations is out of scope for v0.2.

### 5. Scoring is rule-based, explainable, and precision-first

Candidate scores are computed from deterministic rules (anchor bonus,
direct call, direct import, component usage, graph distance decay,
fan-in penalty for shared infrastructure). No LLM participates in
scoring. Traversal depth is capped at 3. Precision is optimized over
recall: a missed file can be accepted by hand; fifty wrong files in
every feature kills the product.

## Consequences

- `CALLS`/`CONTAINS` edges make symbol-level impact analysis
  (dogfooding P1) implementable without new analyzers.
- The suggestion store adds tables for candidate relations and their
  review state; rescan must preserve `accepted`/`rejected` verdicts and
  re-derive `suggested` from the current graph.
- Fixtures need ground-truth mappings to measure Precision/Recall of
  mapping quality (docs/TESTING_STRATEGY.md extension).
- `featuremap inspect <file>` exposes the raw graph so users can
  audit why any candidate was produced — the evidence path
  (AGENTS.md §15) stays the default answer.
