/**
 * SCM provider abstraction (Phase 4 / ADR-0006 §1).
 *
 * v0.4.1 implements the check-run surface needed by a GitHub Check;
 * PR read/comment methods arrive with the GitHub App (v0.4.2) — the
 * interface grows there instead of shipping dead code today.
 */

/** Check-run conclusion (GitHub Checks API vocabulary, subset). */
export type CheckConclusion =
  | 'success'
  | 'neutral'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'skipped';

/** `output` block of a GitHub check run (title + summary + text). */
export interface CheckRunOutput {
  title: string;
  /** One-line summary shown in the checks list. */
  summary: string;
  /** Full markdown body. */
  text: string;
}

export interface CheckRunInput {
  name: string;
  headSha: string;
  conclusion: CheckConclusion;
  output: CheckRunOutput;
}

export interface CheckRunRef {
  id: string;
}

export interface IssueCommentRef {
  id: string;
}

export interface IssueComment extends IssueCommentRef {
  body: string;
}

/** A create-or-update operation resolved against a provider. */
export interface SyncCheckResult {
  id: string;
  /** true when an existing run was updated instead of created. */
  updated: boolean;
}

export interface SCMProvider {
  /** Create a new check run on the head commit. */
  createCheckRun(input: CheckRunInput): Promise<CheckRunRef>;
  /** Update an existing check run (persistent check, ADR-0006 §3). */
  updateCheckRun(id: string, input: Omit<CheckRunInput, 'name' | 'headSha'>): Promise<void>;
  /** Latest run with the given name on a commit, if any. */
  findCheckRunByName(headSha: string, name: string): Promise<CheckRunRef | undefined>;
  /** Issue comments on a pull request (for the single persistent comment, ADR-0007 §3). */
  listIssueComments(prNumber: number): Promise<IssueComment[]>;
  /** Post a new comment on a pull request. */
  postIssueComment(prNumber: number, body: string): Promise<IssueCommentRef>;
  /** Update an existing comment in place. */
  updateIssueComment(commentId: string, body: string): Promise<void>;
}

/** Errors from a provider are wrapped so callers can distinguish analysis vs transport failures. */
export class ScmError extends Error {
  constructor(
    public readonly code: 'API_ERROR' | 'AUTH_MISSING' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}
