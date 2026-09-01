# Context Ranking (Phase 5 / AI Context Layer)

> Normative implementation: `packages/context/src/context-ranker.ts`.

## 1. Goal

Never dump a feature's whole closure into a prompt. Rank every candidate
code item deterministically, then let the token budget pick by priority.
**Precision first, Evidence driven** — a low-confidence or shared file
must lose to a confirmed, feature-specific file every time.

## 2. Tiers

| Tier | Meaning | Examples |
| --- | --- | --- |
| 1 | **Feature core implementation** | anchors (declared), accepted owns, owns distance ≤ 1, entry points |
| 2 | **Direct dependencies** | DEPENDS_ON distance ≤ 1 with confidence ≥ 0.65; owns distance 2 |
| 3 | **Important influence relations** | dependents (reverse IMPORTS), distance-2 dependencies, background assets |
| 4 | **Background information** | distance 3, low confidence, shared-infrastructure noise |

`--depth <n>` (default 3) caps relational expansion; entries beyond the
depth are demoted to Tier 4 rather than removed.

## 3. Priorities (in order)

1. **Anchor status** — anchors (declared candidates, endpoint/CLI assets)
   always land in Tier 1 (`ANCHOR_BONUS` on top of score).
2. **Relation status** — human-confirmed facts outrank inference:
   `declared = accepted = 1.0 > suggested = 0.85`.
3. **Relation kind** — `owns` (1.0) above `DEPENDS_ON` (0.55).
4. **Graph distance** — stored `distance` from the nearest anchor.
5. **Shared-infrastructure penalty** — fan-in ≥ 3 down-weights a file;
   candidate scores already carry the fan-in factor from
   anchor-driven expansion (ADR-0003 §5), and asset-only entries are
   multiplied by `min(1, 3 / fanIn)`.
6. **Recent-change relevance** — paths touched in the recent window get
   `+0.1` and a `recent` flag.
7. **Task-aware boost** — see below; boosts reorder within a tier, never
   cross a tier boundary.

The composite score is deterministic:

```ts
score = candidateScore × statusWeight × relationWeight
        + (isAnchor ? 0.15 : 0)
        + (recent ? 0.10 : 0)
        + taskBoost          // 0 … +0.6
```

## 4. Section placement

| Section | Source |
| --- | --- |
| `entryPoints` | assets of type `endpoint` / `cli_command` |
| `coreCode` | candidates with `relation = owns`, plus data entities and uncovered owned file assets |
| `dependencies` | candidates with `relation = DEPENDS_ON` |
| `dependents` | reverse `IMPORTS` edges into owned files |
| `tests` | test assets associated with the feature |
| `policies` / `constraints` | feature-scoped instructions (`required` = constraints) |
| `recentChanges` | commits touching owned paths |
| `changeRisks` | rule-table over recent changes (below) |

Deduplication: a file shown by any candidate — file-level or as the
container of a symbol-level candidate — never re-appears as a background
"owns" asset (regression-guarded in tests).

## 5. Task-aware ranking

`--task "fix session expiration after login"` never touches the graph.
It extracts terms (`session`, `expiration`, …; stop words and length < 3
dropped) and boosts entries whose path/symbol/relations/commit messages
match:

| Match | Boost |
| --- | --- |
| whole path segment / word boundary | `+0.4` |
| substring in path/name/relations | `+0.2` |
| commit message contains a term | marks `taskMatched` on recent changes |

Total task boost is capped at `+0.6`. The LLM is **not** required here;
if AI is ever introduced it may only handle summarization/compression,
never the mapping itself (AGENTS.md §3.2).

## 6. Change risks (deterministic rule table)

Risks derive from the recent-change window (≤ 5 commits) and mirror the
ADR-0005 band style — never an opaque percentage:

| Rule | Band |
| --- | --- |
| anchor / entry-point file changed | HIGH |
| shared file (fan-in ≥ 3) changed | MEDIUM |
| `fix`-kind commit touched core | MEDIUM |
| core changed, related tests did not move (feature has tests) | MEDIUM |

Every risk carries its evidence row (commit sha + `MODIFIED_BY`).

## 7. Why it stays honest

- Ordering is a pure function of stored graph rows (candidates, assets,
  evidence, commits) — no randomness, no LLM.
- Low-confidence and high-fan-in items lose deterministically, so
  "Logger changed" noise cannot pollute context (same boundary as
  ADR-0004 §4 shared-infrastructure isolation).