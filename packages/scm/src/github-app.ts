/**
 * GitHub App provider (Phase 4 / ADR-0007 §2).
 *
 * Authenticates as a GitHub App installation: mints an app JWT from
 * the private key, exchanges it for an installation access token, and
 * caches the token until ~1 minute before expiry. All API calls go
 * through the shared `GitHubRestClient` with the installation token.
 *
 * The installation id is per-app-per-organization; the App resolves it
 * from the webhook payload (`installation.id`) or explicit config.
 */
import { createAppJwt, getInstallationToken } from './app-auth.js';
import { GitHubRestClient, type RestClientOptions } from './github.js';
import type { CheckRunInput, CheckRunRef, IssueComment, IssueCommentRef, SCMProvider } from './provider.js';

export interface GitHubAppProviderOptions {
  appId: string;
  /** PEM RSA private key (PKCS#1 or PKCS#8). */
  privateKey: string;
  installationId: string;
  owner: string;
  repo: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Skips the token cache (tests). Default false. */
  noCache?: boolean;
}

export class GitHubAppProvider implements SCMProvider {
  private readonly client: GitHubRestClient;
  private cached?: { token: string; expiresAtMs: number };

  constructor(private readonly options: GitHubAppProviderOptions) {
    const clientOptions: RestClientOptions = {
      owner: options.owner,
      repo: options.repo,
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      tokenProvider: () => this.installationToken(),
    };
    this.client = new GitHubRestClient(clientOptions);
  }

  /** Cached installation token, refreshed shortly before expiry. */
  private async installationToken(): Promise<string> {
    if (this.options.noCache !== true && this.cached && this.cached.expiresAtMs > Date.now() + 60_000) {
      return this.cached.token;
    }
    const jwt = createAppJwt(this.options.appId, this.options.privateKey);
    const token = await getInstallationToken({
      jwt,
      installationId: this.options.installationId,
      baseUrl: this.options.baseUrl,
      fetchImpl: this.options.fetchImpl,
    });
    const expiresAtMs = token.expiresAt ? Date.parse(token.expiresAt) : Date.now() + 60 * 60_000;
    this.cached = { token: token.token, expiresAtMs };
    return token.token;
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
