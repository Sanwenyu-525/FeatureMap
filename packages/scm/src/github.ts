/**
 * GitHub REST client + fixed-token provider (Phase 4 / ADR-0006 §2,
 * ADR-0007 §2).
 *
 * `GitHubRestClient` is token-agnostic: it takes a `tokenProvider` and
 * is shared by the fixed-token `GitHubProvider` and the installation-
 * authenticated `GitHubAppProvider`. `baseUrl`/`fetchImpl` are
 * injectable so tests exercise the exact request contract.
 *
 * No source content is ever sent — only rendered reports and comment
 * bodies (AGENTS.md §13).
 */
import { ScmError, type CheckRunInput, type CheckRunRef, type IssueComment, type IssueCommentRef, type SCMProvider } from './provider.js';

export interface GitHubOptions {
  token: string;
  owner: string;
  repo: string;
  /** Defaults to the public GitHub API. Tests inject a fake origin. */
  baseUrl?: string;
  /** Injectable fetch (Node ≥ 22 global). Tests inject a fake. */
  fetchImpl?: typeof fetch;
}

export interface RestClientOptions {
  owner: string;
  repo: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Async because installation tokens are minted on demand (ADR-0007 §2). */
  tokenProvider: () => Promise<string>;
}

interface GitHubCheckRunJson {
  id: number;
  name?: string;
}

interface ListCheckRunsJson {
  total_count: number;
  check_runs: GitHubCheckRunJson[];
}

interface IssueCommentJson {
  id: number;
  body?: string;
}

const API_VERSION = '2022-11-28';

export class GitHubRestClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RestClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
    const impl = options.fetchImpl ?? fetch;
    if (typeof impl !== 'function') {
      throw new ScmError('AUTH_MISSING', 'Global fetch is unavailable; provide fetchImpl.');
    }
    this.fetchImpl = impl;
  }

  async createCheckRun(input: CheckRunInput): Promise<CheckRunRef> {
    const json = (await this.request('POST', `/repos/${this.repo}/check-runs`, {
      name: input.name,
      head_sha: input.headSha,
      status: 'completed',
      conclusion: input.conclusion,
      output: input.output,
    })) as GitHubCheckRunJson;
    return { id: String(json.id) };
  }

  async updateCheckRun(id: string, input: Omit<CheckRunInput, 'name' | 'headSha'>): Promise<void> {
    await this.request('PATCH', `/repos/${this.repo}/check-runs/${id}`, {
      status: 'completed',
      conclusion: input.conclusion,
      output: input.output,
    });
  }

  async findCheckRunByName(headSha: string, name: string): Promise<CheckRunRef | undefined> {
    const json = (await this.request(
      'GET',
      `/repos/${this.repo}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
    )) as ListCheckRunsJson;
    const match = (json.check_runs ?? []).find((run) => run.name === name);
    return match ? { id: String(match.id) } : undefined;
  }

  async listIssueComments(prNumber: number): Promise<IssueComment[]> {
    const json = (await this.request(
      'GET',
      `/repos/${this.repo}/issues/${prNumber}/comments`,
    )) as IssueCommentJson[];
    return (json ?? []).map((c) => ({ id: String(c.id), body: c.body ?? '' }));
  }

  async postIssueComment(prNumber: number, body: string): Promise<IssueCommentRef> {
    const json = (await this.request('POST', `/repos/${this.repo}/issues/${prNumber}/comments`, {
      body,
    })) as IssueCommentJson;
    return { id: String(json.id) };
  }

  async updateIssueComment(commentId: string, body: string): Promise<void> {
    await this.request('PATCH', `/repos/${this.repo}/issues/comments/${commentId}`, { body });
  }

  private get repo(): string {
    return `${this.options.owner}/${this.options.repo}`;
  }

  private async request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
    const token = await this.options.tokenProvider();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'User-Agent': 'featuremap/0.0.1',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new ScmError(
        response.status === 404 ? 'NOT_FOUND' : 'API_ERROR',
        `GitHub ${method} ${path} failed: ${response.status} ${response.statusText}`,
      );
    }
    if (response.status === 204) return undefined;
    return response.json();
  }
}

/** Fixed-token provider (GitHub Actions token / PAT). */
export class GitHubProvider implements SCMProvider {
  private readonly client: GitHubRestClient;

  constructor(options: GitHubOptions) {
    this.client = new GitHubRestClient({
      owner: options.owner,
      repo: options.repo,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      tokenProvider: async () => options.token,
    });
  }

  createCheckRun(input: CheckRunInput): Promise<CheckRunRef> {
    return this.client.createCheckRun(input);
  }

  updateCheckRun(id: string, input: Omit<CheckRunInput, 'name' | 'headSha'>): Promise<void> {
    return this.client.updateCheckRun(id, input);
  }

  findCheckRunByName(headSha: string, name: string): Promise<CheckRunRef | undefined> {
    return this.client.findCheckRunByName(headSha, name);
  }

  listIssueComments(prNumber: number): Promise<IssueComment[]> {
    return this.client.listIssueComments(prNumber);
  }

  postIssueComment(prNumber: number, body: string): Promise<IssueCommentRef> {
    return this.client.postIssueComment(prNumber, body);
  }

  updateIssueComment(commentId: string, body: string): Promise<void> {
    return this.client.updateIssueComment(commentId, body);
  }
}
