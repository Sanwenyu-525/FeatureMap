# ADR-0006: PR Intelligence — GitHub Check transport (v0.4.1)

- Status: Accepted

- Scope: Phase 4 (v0.4.1) — `featuremap gh check`, `packages/scm`,
  `apps/github-action`

## Context

v0.4.0 delivered the local feature-aware PR report (`featuremap pr`,
ADR-0005). v0.4.1 is the first transport: post that report to a
Pull Request as a GitHub Check. The plan is deliberately staged —
analysis first, transport second — and the transport is kept thin so
the analysis stays the product (ADR-0005 §1).

## Decisions

### 1. SCM provider abstraction, GitHub only

`packages/scm` defines a small `SCMProvider` interface covering the
check-run surface actually used in v0.4.1 (create / update / find by
name). The PR read/comment methods from the original plan are **not**
declared yet — they arrive with the GitHub App in v0.4.2 instead of
shipping as dead interface methods. One implementation ships:
`GitHubProvider`, a native-fetch REST client over the GitHub Checks
API. `baseUrl` and `fetchImpl` are injectable so tests exercise the
exact request contract without credentials.

### 2. Check output is generated from the report, never from source

`renderPrCheck(PrReport)` is a pure function producing
`{ conclusion, title, summary, text }`. The markdown body contains
normalized report data only — no source content, no diff bodies
(AGENTS.md §13). The title is a stable name
(`FeatureMap / Pull Request Analysis`) so re-runs update one run.

### 3. One persistent check, no per-push comments

The runner resolves the latest run with the check name on the head
commit and updates it in place; only when absent does it create one.
Comments are avoided entirely in v0.4.1 (ADR-0006 §3 of the phase
plan: prefer Checks, reserve comments for the later App milestones).

### 4. Conclusion mapping is informational, never a merge gate

- `success` — risk not HIGH and no broken mapping relation.
- `neutral` — risk HIGH or a `relation_broken` mapping signal
  ("review recommended").
- `failure` — the analysis itself failed (scan or report error); the
  runner reports it as a failing check rather than swallowing it.

This matches the phase plan §14: phase one is informational/warning
only; FeatureMap never blocks merge in v0.4.x.

### 5. The runner owns the orchestration

`runGitHubCheck(repoRoot, opts)` runs (optionally) `runScan`, then
`buildPrReport`, then `renderPrCheck`, then syncs the check through
the injected provider. The GitHub Action is a thin shell over the
same runner — it only reads the Actions environment and the PR event
payload. Tests inject `InMemoryProvider`, so the whole flow is
exercised end-to-end without network or credentials.

## Consequences

- New package `packages/scm` (provider, GitHub client, renderer,
  runner, in-memory test double).
- New app `apps/github-action` — `action.yml` + bundled entry; callers
  must check out with `fetch-depth: 0` so the base SHA is available.
- CLI: `featuremap gh check [--base <ref>] [--head <sha>] [--owner
  <owner>] [--repo <repo>] [--dry-run] [--json] [--skip-scan]`; reads
  `GITHUB_TOKEN` / `GITHUB_REPOSITORY` / `GITHUB_SHA` /
  `GITHUB_BASE_REF`. `--dry-run` renders without any HTTP call.
- No schema change; no new dependency beyond esbuild (action bundling).
- Out of scope for v0.4.1: PR comments, GitHub App / webhooks / org
  installation, GitLab, persistent comment threads, check annotations.
