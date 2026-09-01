# Dogfooding Report — FeatureMap on FeatureMap

- Date: 2026-09-01
- Method: `featuremap scan` on this repository, then read every feature card through the MCP tools (`list_features` / `get_feature_context` / `get_affected_features`) — deliberately working through the system instead of around it.
- Commit under test: develop @ `917ade9` era build (370 files, 2814 symbols, 18 endpoints, 16 documents, 549 evidence records, 12 commits).

## 1. What the system auto-discovered (zero manual metadata)

9 features. 7 real (from API_SPEC endpoints), 2 noise (from `test-fixtures/` being scanned):

| Feature | Pattern | Anchors | Health (impl / tests / docs) |
|---|---|---|---|
| Analyzers | Generic | GET /api/analyzers | unknown / present / missing |
| Changes | Generic | GET /api/changes | unknown / present / missing |
| Evidence | Generic | GET /api/features/:id/evidence | unknown / present / missing |
| Features | Generic | GET /api/features, /:id | unknown / present / missing |
| Overview | Generic | GET /api/overview | unknown / present / missing |
| Project | Generic | GET /api/project | unknown / present / missing |
| Scan | Generic | POST /api/scan | unknown / present / missing |
| Login *(fixture noise)* | Authentication | POST /api/login (fixture) | complete / missing / missing |
| Users *(fixture noise)* | Generic | GET /api/users (fixture) | complete / missing / missing |

## 2. Dogfooding found a real P0 bug on day one

Every feature card initially showed `tests: missing` and 2-item closures
(just the hub file) — despite 85 passing tests and a heavily
interconnected codebase.

**Root cause:** `resolveSpecifier` in the TypeScript analyzer only tried
`base + suffix` candidates. This codebase uses NodeNext-style imports
(`import { x } from './foo.js'` where the file is `foo.ts`), so **every
single intra-package IMPORTS edge failed to resolve**.

**Fix (shipped in the same session):** candidate expansion now maps
`.js → .ts/.tsx` (and `.jsx → .tsx/.ts`) plus `index.*` variants.
Evidence count went 517 → 549; all seven API features flipped to
`tests: present`.

This validates the dogfooding thesis: the system's own health display
caught a real defect that `tsc`/vitest never surface, because both are
happy with `.js`-for-`.ts` imports.

## 3. Answers to the five dogfooding questions

### Q1 — Is finding a feature really faster than full-text search?

**For API-level features: yes.** `feature:scan` → endpoint, file,
health, evidence chain in one query, no grep.

**For core library features: no.** The most important features of this
project — scanner, analyzer platform, feature discovery, impact
traversal, MCP server — **were not discovered at all**, because they
are library code with no HTTP endpoints. Discovery is currently an
"API feature finder". Finding "where is impact traversal implemented?"
still required full-text search (Q1 verdict: partially).

### Q2 — Would I check the page before modifying a feature?

Honest answer today: **only for server routes.** Before touching
`packages/server/src/app.ts` the feature list is genuinely useful
(which endpoints live here, what did I name them). Before touching
`packages/pipeline/src/feature-discovery.ts` the page has nothing for
me. Adoption follows coverage, not habit.

### Q3 — After AI writes code, can I quickly see what it broke?

**Mechanism works; reach was the limiter, now improved.** The impact
traversal starts from `MODIFIED_BY` evidence and follows
BELONGS_TO_FEATURE / IMPORTS. Before the P0 fix, transitive reach was
nearly zero (no IMPORTS edges). After the fix, a change to
`packages/server/src/app.ts` surfaces all affected API features with
per-reason evidence. The current working tree was clean at review time
(`CURRENT IMPACT: []` — correct behaviour, no invented results).

What is still missing for this question: symbol-level impact
(changed-lines → changed symbols), planned as a Milestone 4 follow-up.

### Q4 — Is the information expensive to maintain? (critical)

**Auto-derived dimensions: zero maintenance.** Files, symbols,
endpoints, tests-health, docs-health, git history — all rebuild on
every `scan`. This is the part of the thesis that holds.

**Manual dimensions: currently impossible, not just expensive.**
Feature descriptions, dependency (depended-on / depends-on) edges, and
human "status: done" flags have no write path. DATA_MODEL.md §7
designed `manual_overrides` for exactly this; it is not implemented
yet (P1 below). Verdict: the no-metadata-maintenance bar is met, but
only because there is nothing manual yet.

### Q5 — Does the information go stale? (critical)

**Auto dimensions cannot go stale** as long as you re-scan; each scan
is a full rebuild keyed by content hashes. The real staleness risk
arrives with manual metadata (Q4): a hand-written "depends on" edge
will silently rot. Mitigation designed but not built: re-validate
manual edges on each scan and mark detached ones as drifted.

## 4. Issue list (P0–P3)

| Pri | Issue | Evidence from this session | Status |
|---|---|---|---|
| P0 | `.js`-suffixed imports of `.ts` files never resolved → IMPORTS graph was empty intra-package | all feature closures were 1-file, tests/docs health always missing | **Fixed** this session |
| P1 | Library/CLI features are invisible (only HTTP endpoints anchor features) | scanner/analyzer/pipeline/impact/mcp absent from feature list | Open — needs export-symbol or CLI-command anchoring |
| P1 | `implementation: unknown` for inline handlers | `app.get('/api/x', async (...) => {})` has no named handler to resolve | Open — express analyzer should capture inline arrow handlers |
| P2 | No manual-override write path (descriptions, dependency edges, status) | Q4/Q5 of this report | Open — DATA_MODEL.md §7 tables exist, no tooling |
| P2 | Fixture repos scanned as if they were product code (`test-fixtures/**`) | Login/Users noise features | Open — default ignore should cover test-fixtures, or flag them as fixture scope |
| P3 | Feature naming for API resources is thin ("Analyzers", "Project") | resource-segment naming | Accepted for MVP; LLM naming is post-MVP |
| P3 | `documentation: missing` is technically correct but undersells README/API_SPEC prose | docs describe capabilities, not file paths | Open — semantic doc mapping was deferred from M2 |

## 5. Verdict

- The **evidence-first architecture holds**: every claim on every card
  traced back to stored evidence, and the health display caught a real
  graph defect on first contact.
- The **zero-maintenance promise holds for what is automatic**; the
  project must resist adding manual metadata until overrides exist
  (they would rot).
- The **coverage gap is the real threat**: without anchoring for
  non-HTTP features, the product answers a narrower question than the
  README promises. P1 items above are the next milestones, before any
  polish work.
