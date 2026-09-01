/**
 * GitHub check runner (Phase 4 / ADR-0006 §4) — v0.4.1.
 *
 * Orchestrates the thin transport: optional scan of the checkout →
 * `buildPrReport` → `renderPrCheck` → create-or-update a persistent
 * check run on the head commit (ADR-0006 §3: same name, updated in
 * place, never a comment per push).
 *
 * Analysis failures are reported as a `failure` check run instead of
 * being swallowed; transport errors (auth/network) propagate — the
 * runner cannot post a failure through a broken provider.
 */
import { buildPrReport, runScan } from '@featuremap/pipeline';
import { DEFAULT_CHECK_NAME, renderPrCheck, type RenderedCheck } from './check-renderer.js';
import type { CheckRunInput, SCMProvider, SyncCheckResult } from './provider.js';

export interface RunGitHubCheckOptions {
  provider: SCMProvider;
  /** `owner/repo` on the platform (GitHub only in v0.4.1). */
  owner: string;
  repo: string;
  /** Commit the check is attached to (PR head). */
  headSha: string;
  /** Commit range passed to `buildPrReport`, e.g. `${baseSha}..HEAD`. */
  range: string;
  checkName?: string;
  /** Scan the checkout before reporting (GitHub Action: true). */
  scan?: boolean;
  /** Override the SQLite store location (tests). */
  dbPath?: string;
}

export interface RunGitHubCheckResult {
  id: string;
  /** true when an existing run was updated in place (persistent check). */
  updated: boolean;
  /** false when the analysis itself failed (reported as a failure check). */
  ok: boolean;
  /** Conclusion posted to GitHub ('failure' when !ok). */
  conclusion: 'success' | 'neutral' | 'failure';
  /** The rendered report (when ok) — used by the App for the comment decision. */
  rendered?: RenderedCheck;
  /** The check-run summary that was posted. */
  summary: string;
}

async function syncCheck(provider: SCMProvider, input: CheckRunInput): Promise<SyncCheckResult> {
  const existing = await provider.findCheckRunByName(input.headSha, input.name);
  if (existing) {
    await provider.updateCheckRun(existing.id, input);
    return { id: existing.id, updated: true };
  }
  const created = await provider.createCheckRun(input);
  return { id: created.id, updated: false };
}

export async function runGitHubCheck(repoRoot: string, options: RunGitHubCheckOptions): Promise<RunGitHubCheckResult> {
  const checkName = options.checkName ?? DEFAULT_CHECK_NAME;

  let report: Awaited<ReturnType<typeof buildPrReport>>;
  try {
    if (options.scan !== false) {
      await runScan(repoRoot, { dbPath: options.dbPath });
    }
    report = await buildPrReport(repoRoot, { range: options.range, dbPath: options.dbPath });
  } catch (err) {
    // Analysis failure → a failing check, never silently dropped (ADR-0006 §4).
    const message = err instanceof Error ? err.message : String(err);
    const input: CheckRunInput = {
      name: checkName,
      headSha: options.headSha,
      conclusion: 'failure',
      output: {
        title: DEFAULT_CHECK_NAME,
        summary: `Analysis failed: ${message}`,
        text: `\`\`\`\n${message}\n\`\`\``,
      },
    };
    const { id, updated } = await syncCheck(options.provider, input);
    return { id, updated, ok: false, conclusion: 'failure', summary: input.output.summary };
  }

  const rendered: RenderedCheck = renderPrCheck(report);
  const input: CheckRunInput = {
    name: checkName,
    headSha: options.headSha,
    conclusion: rendered.conclusion,
    output: { title: rendered.title, summary: rendered.summary, text: rendered.text },
  };
  const { id, updated } = await syncCheck(options.provider, input);
  return { id, updated, ok: true, conclusion: rendered.conclusion, rendered, summary: rendered.summary };
}
