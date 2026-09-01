# ADR-0007: PR Intelligence — GitHub App (v0.4.2)

- Status: Accepted

- Scope: Phase 4 (v0.4.2) — App installation auth, webhook receiver,
  rare review comments, `apps/github-app`

## Context

v0.4.1 delivers the GitHub Check transport driven by a GitHub Action
(`featuremap gh check`, ADR-0006). The next stage is the GitHub App:
an always-on receiver that acts as an organization installation, so
the same feature-aware analysis is available across an org without
each repo wiring an Action — webhook, persistent checks, and (rare)
PR comments (phase plan §10: comments only when review is
recommended).

## Decisions

### 1. App installation authentication (JWT → installation token)

`packages/scm/src/app-auth.ts`:

- `createAppJwt(appId, privateKey, now?)` — RS256 JWT, issuer = app id,
  lifetime 10 minutes (GitHub's maximum), signed with the app's PEM
  private key.

- `getInstallationToken({ jwt, installationId })` —
  `POST /app/installations/{id}/access_tokens`, returns
  `{ token, expires_at }`.

- `verifyWebhookSignature(secret, rawBody, header)` — HMAC-SHA256 of
  the **raw** webhook body, constant-time compare; false on missing
  header.

The private key and webhook secret live in deployment environment /
secrets; they are never logged (AGENTS.md §13).

### 2. One token-agnostic REST client

`GitHubRestClient` (ADR-0006 §2 refactor) takes a `tokenProvider`
instead of a fixed token and now also exposes the comment surface
(`listIssueComments` / `postIssueComment` / `updateIssueComment`).
Two providers share it:

- `GitHubProvider` — fixed token (Actions token / PAT).

- `GitHubAppProvider` — installation token, minted once and cached
  until \~1 minute before `expires_at`.

### 3. Webhook dispatch: check always, comment only on review-needed

`handleWebhook(rawBody, opts)` parses the `pull_request` payload
(base/head shas, owner/repo), runs `runGitHubCheck`, and maintains the
persistent check. A PR comment is **only** created/updated when the
conclusion is `neutral` — HIGH risk or a broken mapping relation — and
it is ONE comment per PR, found by a marker
(`<!-- featuremap:pr-review -->`) and updated in place (phase plan
§10: the check is the primary channel; comments stay rare).

### 4. The App is a thin Fastify shell

`apps/github-app` is a Fastify server with a raw-body parser. On
`POST /webhook` it verifies the HMAC signature (401 on mismatch),
resolves the installation id from the payload (`installation.id`, org
install support; or explicit env), builds a `GitHubAppProvider` for
the event, and dispatches. v0.4.2 is single-repo: owner/repo and a
local checkout (`FEATUREMAP_REPO_ROOT`) are configured once; the
checkout is refreshed out-of-band. Multi-repo checkout management is
a later milestone.

## Consequences

- `packages/scm` gains `app-auth.ts`, `github-app.ts`, `webhook.ts`;
  `GitHubRestClient` is shared by both providers.

- `apps/github-app` — Fastify webhook server (env-configured, no
  schema change).

- `runGitHubCheck` now returns `conclusion` and the rendered check so
  the App can decide about comments.

- Tests: app-auth (ephemeral RSA key verifies the JWT), webhook
  signature, installation token exchange (mock fetch), `GitHubAppProvider`
  token caching, and webhook dispatch end-to-end with `InMemoryProvider`
  (check created; comment created then updated on re-run).

- The Action remains the light-weight path; the App is the org-scale
  path. Both share the same analysis and renderer.

- Out of scope for v0.4.2: multi-repo checkout manager, App manifest
  generation, market/installation UX, webhook event retries/queue.

