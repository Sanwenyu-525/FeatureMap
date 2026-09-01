/**
 * GitHub App webhook handling (Phase 4 / ADR-0007 §3).
 *
 * The webhook endpoint receives the raw body (signature verified by
 * the server shell), this module parses it and dispatches:
 *
 *   pull_request → resolve base/head → `runGitHubCheck` → persistent
 *   check run. When the conclusion is `neutral` (HIGH risk or a broken
 *   mapping relation) it also maintains ONE persistent comment on the
 *   PR — found by marker, updated in place (phase plan §10: comments
 *   stay rare; the check is the primary channel).
 *
 * Only normalized report data is posted, never source content
 * (AGENTS.md §13).
 */
import { runGitHubCheck } from './runner.js';
import type { SCMProvider } from './provider.js';

/** Marker prefix that identifies FeatureMap's single persistent review comment. */
export const COMMENT_MARKER = '<!-- featuremap:pr-review -->';

export interface PullRequestEvent {
  action?: string;
  installation?: { id?: number };
  repository?: { owner?: { login?: string }; name?: string };
  pull_request?: {
    number?: number;
    base?: { sha?: string };
    head?: { sha?: string };
  };
}

/** Parse a webhook JSON body (throws on invalid JSON). */
export function parseWebhookEvent(rawBody: string): PullRequestEvent {
  return JSON.parse(rawBody) as PullRequestEvent;
}

export interface HandleWebhookOptions {
  /** Local checkout of the PR head the analysis runs against. */
  repoRoot: string;
  provider: SCMProvider;
  checkName?: string;
  /** Scan the checkout before reporting (default true, like the Action). */
  scan?: boolean;
  /** Override the SQLite store location (tests). */
  dbPath?: string;
}

export interface HandleWebhookResult {
  /** false when the payload was not a supported pull_request event. */
  handled: boolean;
  reason: string;
  check?: {
    id: string;
    updated: boolean;
    ok: boolean;
    conclusion: 'success' | 'neutral' | 'failure';
  };
  comment?: { id: string; updated: boolean };
}

/** Minimal comment body for the "review recommended" case (phase plan §10). */
export function renderPrComment(summary: string): string {
  return `${COMMENT_MARKER}\n🚨 FeatureMap — review recommended\n\n${summary}\n\nSee the FeatureMap check on this commit for the full report.`;
}

/** One persistent comment per PR, found by marker and updated in place. */
async function syncComment(
  provider: SCMProvider,
  prNumber: number,
  body: string,
): Promise<{ id: string; updated: boolean }> {
  const existing = (await provider.listIssueComments(prNumber)).find((c) => c.body.startsWith(COMMENT_MARKER));
  if (existing) {
    await provider.updateIssueComment(existing.id, body);
    return { id: existing.id, updated: true };
  }
  const created = await provider.postIssueComment(prNumber, body);
  return { id: created.id, updated: false };
}

export async function handleWebhook(rawBody: string, options: HandleWebhookOptions): Promise<HandleWebhookResult> {
  let event: PullRequestEvent;
  try {
    event = parseWebhookEvent(rawBody);
  } catch {
    return { handled: false, reason: 'invalid JSON' };
  }

  const pr = event.pull_request;
  const repo = event.repository;
  if (!pr?.number || !pr?.base?.sha || !pr?.head?.sha || !repo?.owner?.login || !repo?.name) {
    return { handled: false, reason: 'not a pull_request event with base/head shas' };
  }

  const owner = repo.owner.login;
  const repoName = repo.name;
  const headSha = pr.head.sha;
  const range = `${pr.base.sha}..HEAD`;

  const result = await runGitHubCheck(options.repoRoot, {
    provider: options.provider,
    owner,
    repo: repoName,
    headSha,
    range,
    checkName: options.checkName,
    scan: options.scan,
    dbPath: options.dbPath,
  });

  // Comment only when review is recommended — HIGH risk or broken mapping.
  let comment: { id: string; updated: boolean } | undefined;
  if (result.ok && result.conclusion === 'neutral' && result.rendered) {
    comment = await syncComment(options.provider, pr.number, renderPrComment(result.rendered.summary));
  }

  return {
    handled: true,
    reason: result.ok ? 'analyzed' : 'analysis failed',
    check: { id: result.id, updated: result.updated, ok: result.ok, conclusion: result.conclusion },
    comment,
  };
}
