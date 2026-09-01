/**
 * GitHubProvider tests — mocked fetch (Phase 4 / ADR-0006 §2).
 *
 * No credentials or network: `fetchImpl` captures the exact request
 * contract and returns canned responses.
 */
import { describe, expect, it, vi } from 'vitest';
import { GitHubProvider } from '../src/github.js';
import { ScmError } from '../src/provider.js';

type RequestRecord = {
  url: string;
  init: RequestInit;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeProvider(requests: RequestRecord[], respond: (req: RequestRecord) => Response) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const record: RequestRecord = { url: String(url), init: init ?? {} };
    requests.push(record);
    return respond(record);
  }) as unknown as typeof fetch;
  return new GitHubProvider({ token: 'tok', owner: 'acme', repo: 'app', fetchImpl });
}

describe('GitHubProvider', () => {
  it('creates a check run with the expected request shape', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests, () => jsonResponse({ id: 42 }));

    const ref = await provider.createCheckRun({
      name: 'FeatureMap / Pull Request Analysis',
      headSha: 'abc123',
      conclusion: 'success',
      output: { title: 't', summary: 's', text: 'body' },
    });

    expect(ref).toEqual({ id: '42' });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe('https://api.github.com/repos/acme/app/check-runs');
    expect(req.init.method).toBe('POST');
    const headers = req.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['Accept']).toBe('application/vnd.github+json');
    const body = JSON.parse(String(req.init.body)) as Record<string, unknown>;
    expect(body['head_sha']).toBe('abc123');
    expect(body['status']).toBe('completed');
    expect(body['conclusion']).toBe('success');
    expect((body['output'] as Record<string, string>)['summary']).toBe('s');
  });

  it('updates an existing check run via PATCH', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests, () => jsonResponse({ id: 42 }));

    await provider.updateCheckRun('42', {
      conclusion: 'neutral',
      output: { title: 't', summary: 's2', text: 'body2' },
    });

    expect(requests[0]!.url).toBe('https://api.github.com/repos/acme/app/check-runs/42');
    expect(requests[0]!.init.method).toBe('PATCH');
    const body = JSON.parse(String(requests[0]!.init.body)) as Record<string, unknown>;
    expect(body['conclusion']).toBe('neutral');
  });

  it('finds the latest run by exact name on a commit', async () => {
    const requests: RequestRecord[] = [];
    const provider = makeProvider(requests, () =>
      jsonResponse({
        total_count: 2,
        check_runs: [
          { id: 1, name: 'Other' },
          { id: 2, name: 'FeatureMap / Pull Request Analysis' },
        ],
      }),
    );

    const found = await provider.findCheckRunByName('abc123', 'FeatureMap / Pull Request Analysis');
    expect(found).toEqual({ id: '2' });
    expect(requests[0]!.url).toContain('/commits/abc123/check-runs');
    expect(requests[0]!.init.method).toBe('GET');
  });

  it('returns undefined when no run matches the name', async () => {
    const provider = makeProvider([], () => jsonResponse({ total_count: 0, check_runs: [] }));
    await expect(provider.findCheckRunByName('abc', 'nope')).resolves.toBeUndefined();
  });

  it('throws ScmError on non-2xx responses', async () => {
    const provider = makeProvider([], () => jsonResponse({ message: 'nope' }, 401));
    await expect(
      provider.createCheckRun({
        name: 'n',
        headSha: 'h',
        conclusion: 'success',
        output: { title: 't', summary: 's', text: 'b' },
      }),
    ).rejects.toBeInstanceOf(ScmError);
  });
});
