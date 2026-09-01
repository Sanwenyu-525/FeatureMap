/**
 * In-memory provider — test double (Phase 4 / ADR-0006 §4).
 *
 * Records every call and answers from an in-memory map, so the runner
 * can be exercised end-to-end without network or credentials. The
 * call log doubles as the assertion surface.
 */
import type {
  CheckRunInput,
  CheckRunRef,
  IssueComment,
  IssueCommentRef,
  SCMProvider,
  SyncCheckResult,
} from './provider.js';

export interface InMemoryCheckRun extends CheckRunInput {
  id: string;
}

export interface InMemoryComment {
  id: string;
  prNumber: number;
  body: string;
}

export class InMemoryProvider implements SCMProvider {
  readonly runs: InMemoryCheckRun[] = [];
  readonly comments: InMemoryComment[] = [];
  readonly calls: string[] = [];
  private nextId = 1;

  async createCheckRun(input: CheckRunInput): Promise<CheckRunRef> {
    this.calls.push(`create:${input.name}`);
    const run: InMemoryCheckRun = { ...input, id: String(this.nextId++) };
    this.runs.push(run);
    return { id: run.id };
  }

  async updateCheckRun(id: string, input: Omit<CheckRunInput, 'name' | 'headSha'>): Promise<void> {
    this.calls.push(`update:${id}`);
    const run = this.runs.find((r) => r.id === id);
    if (!run) throw new Error(`No such run: ${id}`);
    run.conclusion = input.conclusion;
    run.output = input.output;
  }

  async findCheckRunByName(headSha: string, name: string): Promise<CheckRunRef | undefined> {
    this.calls.push(`find:${headSha}:${name}`);
    const run = [...this.runs].reverse().find((r) => r.headSha === headSha && r.name === name);
    return run ? { id: run.id } : undefined;
  }

  async listIssueComments(prNumber: number): Promise<IssueComment[]> {
    this.calls.push(`comments:${prNumber}`);
    return this.comments
      .filter((c) => c.prNumber === prNumber)
      .map((c) => ({ id: c.id, body: c.body }));
  }

  async postIssueComment(prNumber: number, body: string): Promise<IssueCommentRef> {
    this.calls.push(`comment-post:${prNumber}`);
    const comment: InMemoryComment = { id: String(this.nextId++), prNumber, body };
    this.comments.push(comment);
    return { id: comment.id };
  }

  async updateIssueComment(commentId: string, body: string): Promise<void> {
    this.calls.push(`comment-update:${commentId}`);
    const comment = this.comments.find((c) => c.id === commentId);
    if (!comment) throw new Error(`No such comment: ${commentId}`);
    comment.body = body;
  }

  /** Convenience for runner tests: run create-or-update and report the outcome. */
  async syncCheck(input: CheckRunInput): Promise<SyncCheckResult> {
    const existing = await this.findCheckRunByName(input.headSha, input.name);
    if (existing) {
      await this.updateCheckRun(existing.id, input);
      return { id: existing.id, updated: true };
    }
    const created = await this.createCheckRun(input);
    return { id: created.id, updated: false };
  }
}
