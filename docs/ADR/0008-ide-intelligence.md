# ADR-0008: IDE Intelligence — VS Code first, decoupled headless service, low noise (v0.6)

- Status: Accepted

- Scope: Phase 6 (Milestones 19–24, v0.6.0–v0.6.5) — `apps/vscode-extension`

## Context

Phase 5 delivers context to agents on demand
(`featuremap context`, MCP). Phase 6 moves FeatureMap onto the
developer's main editing path: the developer does **not** run the CLI;
the editor surfaces Feature information automatically (owning features
under the cursor, relation types, change impact, related tests,
constraints). The acceptance criterion is that the extension is worth
leaving on all day — "Low noise, high relevance".

Phases 1–5 already provide every data source the IDE needs: the code
graph (Milestone 6), anchors/candidates with verdicts (Milestones
7–8), change intelligence and severity (Phase 3), deterministic drift
(ADR-0005 §4), and `buildFeatureContext` (Phase 5). Phase 6 is
therefore an **adapter surface**, not a new analysis layer.

## Decisions

### 1. VS Code first; other editors stay an interface

Only `VSCodeExtension` is implemented in v0.6.x. An `IDEAdapter`
interface documents the seam; JetBrains / Neovim / Zed / Visual Studio
are explicitly out of scope. Cursor and other VS Code-compatible hosts
may inherit capability incidentally, but that is a bonus, not a
compatibility commitment. This validates "is Feature info useful in
daily editing?" before investing in cross-editor adapters.

### 2. The extension is an adapter, never an analyzer

No analysis logic lives under `apps/vscode-extension/src/`. The
extension owns UI (providers, views, commands, status bar) and
communication only. It consumes the same analysis path as CLI / API /
MCP: pipeline, context, verdicts, drift. This preserves AGENTS.md §3.1
(Analyzer → Evidence → Feature Graph → Consumer) — the extension is one
more consumer.

### 3. Transport: a headless stdio service, not HTTP

The extension spawns a dedicated headless process
(`featuremap ide`, stdio JSON-RPC — the same pattern as the MCP
server) and owns its lifecycle (spawn on activation, shutdown on
deactivate). Rationale:

- the developer must not have to start `featuremap dev`; the Fastify
  server stays for the Web UI only;
- no loopback HTTP port to allocate, no CSRF/auth surface on localhost
  (AGENTS.md §13, §3.4);
- request/response over stdio matches the existing MCP transport and
  keeps the extension testable against the service contract.

`FeatureMapClient` in the extension is a thin JSON-RPC client with no
business logic.

### 4. No FeatureMap Language Server; consume the host one

FeatureMap does not re-implement definition/reference/symbol via a
custom LSP. For position → symbol resolution in TS/JS projects, the
extension consumes the host TypeScript language service and then looks
up the resolved symbol in FeatureMap's stored graph. A stored-symbol
line-match fallback covers non-TS files. This is strictly *using* the
editor's LSP for one lookup, never *recreating* the code graph
(Milestone 6 already owns that).

### 5. Symbol → Feature needs a derived fast index

The Quality Gate requires `Symbol → Feature < 200ms cached`. A
per-query graph traversal will not hold on real repos, so a derived
in-memory index over `feature_assets` / `feature_candidates` /
`evidence` is built when the service connects and invalidated on
incremental updates (Milestone 21). Confidence and verdict are
preserved in the index — a symbol can surface as OWNED BY / USED BY /
MAY AFFECT, never as an untyped name.

### 6. Low noise, high relevance

- Hover = orientation (owning features, direct deps, related tests,
  last changed — short), Panel = exploration. Hover never renders a
  full feature page.
- CodeLens is opt-in-by-default-quiet: only confirmed /
  high-confidence relations render, and it is configurable in
  `featuremap.yaml` (e.g. `ide.codelens.enabled`).
- Change impact is computed on saved files (debounced) → incremental
  graph update → `analyzeImpact`. Never per-keystroke.

### 7. Reuse verdicts and drift; the IDE is a consumer

Accept / Reject / Explain call the existing verdict path
(ADR-0003 §4) and evidence-chain renderer. Drift diagnostics in the
Problems panel reuse ADR-0005 §4 (`relation_broken`,
`new_candidate`) — deterministic, detect → suggest, never auto-accept.

### 8. Feature Context stays the AI surface

"Build / Copy Agent Context" and "Build Task Context" call
`buildFeatureContext` (Phase 5) and render markdown for copy or
`.featuremap/context/<feature>.md`. No binding to a specific AI
product.

### 9. Explicitly excluded from v0.6

In-IDE AI chat, an in-IDE graph editor, auto-accept of relations,
source mutation, debugger / runtime-trace integration, real-time code
generation, and a custom LSP. FeatureMap's value is structured
engineering context, not "another Cursor".

## Consequences

- New package: `apps/vscode-extension` (extension host is Node; the
  package is a normal pnpm workspace member under `apps/*`).
- New headless service entry: `featuremap ide` (stdio JSON-RPC),
  sharing pipeline / context / review code.
- New derived symbol→feature index with cache invalidation on
  incremental scan (Milestone 21).
- Tests: client unit tests against the service JSON-RPC contract,
  provider tests against a mocked VS Code surface, reuse of existing
  pipeline/context suites, plus one VS Code integration smoke test
  (activation + feature list) in Playwright CI.
- Out of scope for v0.6.x: JetBrains / Neovim / Zed, custom LSP,
  multi-root workspaces, heavy WebView detail panel (TreeView /
  QuickPick / Markdown Preview instead), background full scans beyond
  the saved-file trigger.
