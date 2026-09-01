# ADR-0002: Deterministic feature discovery for the MVP

- Status: Accepted
- Scope: MVP (Milestone 2)

## Context

FeatureMap must group repository evidence into product features.
An LLM-driven approach was possible: send normalized evidence to a
provider and let it name, group and classify features.

However:

- the product is local-first by default (ADR-0001, AGENTS.md §3.4);
- credibility depends on answering "why does this code belong to this
  feature?" (AGENTS.md §15);
- LLM output is non-deterministic, complicating test snapshots and
  incremental scans;
- deterministic signals are already available: endpoints resolve to
  handler symbols, files connect through IMPORTS evidence.

## Decision

Feature discovery in the MVP is fully deterministic:

1. **Anchors** — endpoints anchor candidate features; the route's last
   segment (params stripped) is the resource, and endpoints sharing a
   resource merge into one feature.
2. **Closure** — the feature's implementation files follow IMPORTS
   edges from the endpoint file and handler files. Hub files (those
   registering two or more distinct resources) are not expanded, so a
   central `app.js` cannot pull unrelated features together.
3. **Pattern classification** — keyword rules (Authentication) and
   method-shape rules (CRUD: GET plus at least one write verb).
   Everything else is `Generic`.
4. **Confidence** — anchors (endpoints, handler symbols) map at 1.0;
   closure files at 0.9 (very strong inference, docs/DATA_MODEL.md §4).
5. **Health** — derived per docs/MVP_SPEC.md §9 from evidence presence:
   implementation (handlers resolved), tests (test assets importing
   feature files), documentation (DESCRIBED_BY documents). Never
   percentages.
6. **Evidence** — every mapping emits `BELONGS_TO_FEATURE` with
   analyzer identity `feature-engine`, origin `deterministic`.

LLM participation is limited to future optional refinements (naming,
descriptions) layered on top of the deterministic result; it never
replaces the evidence path (AGENTS.md §3.2).

## Consequences

- Feature results are reproducible and snapshot-testable.
- Incremental scans can reuse discovery results when their input
  evidence is unchanged.
- Naming quality depends on route conventions; unconventional route
  names produce less friendly feature names. The manual override
  mechanism (docs/DATA_MODEL.md §7) is the escape hatch.
- Cross-framework features that share no deterministic path (for
  example, a React page to a REST endpoint with no shared file) are
  not clustered until a connecting evidence type exists. Surfacing
  uncertainty is preferred over inventing links.

## Related decision: `commit` entity type

The MVP adds `commit` to `EntityType` (docs/DATA_MODEL.md §2) so Git
changes participate in the evidence graph (`file MODIFIED_BY
commit:<sha>`) and the impact traversal (Milestone 4) starts from
evidence-backed change records instead of raw git output.
