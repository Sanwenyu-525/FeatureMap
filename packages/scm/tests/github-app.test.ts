/**
 * GitHubAppProvider tests — mocked fetch with a fake installation-token
 * endpoint (Phase 4 / ADR-0007 §2). Verifies the token exchange and
 * caching; no credentials or network.
 */
import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubAppProvider } from '../src/github-app.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

type RequestRecord = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Routes: token endpoint + check endpoint, recording every call. */
function makeProvider(requests: RequestRecord[]) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const record: RequestRecord = { url: String(url), init: init ?? {} };
    requests.push(record);
    const u = String(url);
    if (u.includes('/app/installations/')) return jsonResponse({ token: 'inst-tok', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    if (u.includes('/check-runs') && record.init.method === 'POST') return jsonResponse({ id: 5 });
    if (u.includes('/issues/') && record.init.method === 'POST') return jsonResponse({ id: 6 });
    return jsonResponse({ total_count: 0, check_runs: [] });
  }) as unknown as typeof fetch;

  return new GitHubAppProvider({
    appId: '12345',
    privateKey,
    installationId: '9',
    owner: 'acme',
    repo: 'app',
    fetchImpl,
  });
}

describe('GitHubAppProvider', () => {
  it('mints a token before the first API call and authorizes with it', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests);

    await provider.createCheckRun({
      name: 'FeatureMap / Pull Request Analysis',
      headSha: 'abc',
      conclusion: 'success',
      output: { title: 't', summary: 's', text: 'b' },
    });

    const tokenCall = requests.find((r) => r.url.includes('/app/installations/'));
    expect(tokenCall).toBeDefined();
    const checkCall = requests.find((r) => r.url.includes('/check-runs'));
    const headers = checkCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer inst-tok');
  });

  it('caches the installation token across calls', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests);

    await provider.createCheckRun({ name: 'n', headSha: 'a', conclusion: 'success', output: { title: 't', summary: 's', text: 'b' } });
    await provider.findCheckRunByName('a', 'n');
    await provider.createCheckRun({ name: 'n', headSha: 'a', conclusion: 'success', output: { title: 't', summary: 's', text: 'b' } });

    const tokenCalls = requests.filter((r) => r.url.includes('/app/installations/'));
    expect(tokenCalls).toHaveLength(1);
  });

  it('delegates comment operations to the REST client', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests);
    const ref = await provider.postIssueComment(12, 'body');
    expect(ref.id).toBe('6');
    const commentCall = requests.find((r) => r.url.includes('/issues/12/comments'));
    expect(commentCall!.init.method).toBe('POST');
  });
});
