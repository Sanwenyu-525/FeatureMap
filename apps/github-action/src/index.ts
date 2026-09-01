/**
 * FeatureMap GitHub Action entry (Phase 4 / ADR-0006).
 *
 * Thin shell: reads the standard GitHub Actions environment, resolves
 * the PR base SHA from the event payload, and delegates to
 * `runGitHubCheck` (packages/scm) which does scan → report → check.
 *
 * Usage (caller workflow) must check out with full history so the base
 * SHA is available for the diff:
 *
 *   - uses: actions/checkout@v4
 *     with: { fetch-depth: 0 }
 *   - uses: featuremap/analyze@v1
 *     with: { token: ${{ secrets.GITHUB_TOKEN }} }
 */
import { readFileSync } from 'node:fs';
import { GitHubProvider, runGitHubCheck } from '@featuremap/scm';

interface PrEvent {
  pull_request?: {
    number?: number;
    base?: { sha?: string };
    head?: { sha?: string };
  };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const headSha = process.env.GITHUB_SHA;

  if (!token) throw new Error('GITHUB_TOKEN is required');
  if (!repository) throw new Error('GITHUB_REPOSITORY is required');
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
  if (!headSha) throw new Error('GITHUB_SHA is required');

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);

  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as PrEvent;
  const baseSha = event.pull_request?.base?.sha;
  if (!baseSha) throw new Error('Pull request event payload is missing pull_request.base.sha');

  const provider = new GitHubProvider({ token, owner, repo });
  const result = await runGitHubCheck(process.cwd(), {
    provider,
    owner,
    repo,
    headSha,
    range: `${baseSha}..HEAD`,
    scan: true,
  });

  console.log(`[featuremap] check run ${result.id} ${result.updated ? 'updated' : 'created'} · ${result.summary}`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[featuremap] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
