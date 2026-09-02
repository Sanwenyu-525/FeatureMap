/**
 * FeatureMapClient protocol tests — JSON-RPC over stdio against an
 * injected transport (ADR-0008 §3), so the client contract is verified
 * without spawning real subprocesses.
 */
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FeatureMapClient } from '../src/client/featuremap-client';

interface Harness {
  serverIn: PassThrough;
  serverOut: PassThrough;
  client: FeatureMapClient;
}

function harness(): Harness {
  // The client writes requests to `serverIn` and reads responses from
  // `serverOut`, just like a real spawned `featuremap ide` process.
  const serverIn = new PassThrough();
  const serverOut = new PassThrough();
  const client = new FeatureMapClient({
    stdin: serverIn,
    stdout: serverOut,
    dispose: () => {},
    onExit: () => {},
  });
  return { serverIn, serverOut, client };
}

describe('FeatureMapClient', () => {
  it('sends a request line and resolves the matching response', async () => {
    const { serverIn, serverOut, client } = harness();
    let received: string | undefined;
    const reader = createInterface({ input: serverIn, crlfDelay: Infinity });
    reader.on('line', (line) => {
      received = line;
      const req = JSON.parse(line) as { id: number };
      serverOut.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\n');
    });

    const result = await client.request<{ ok: boolean }>('features.list', {});
    expect(result).toEqual({ ok: true });
    const req = JSON.parse(received!) as { jsonrpc: string; id: number; method: string; params: unknown };
    expect(req.jsonrpc).toBe('2.0');
    expect(req.method).toBe('features.list');
    expect(req.params).toEqual({});
    client.dispose();
  });

  it('rejects with the server error message and code', async () => {
    const { serverIn, serverOut, client } = harness();
    const reader = createInterface({ input: serverIn, crlfDelay: Infinity });
    reader.on('line', (line) => {
      const req = JSON.parse(line) as { id: number };
      serverOut.write(
        JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'FEATURE_NOT_FOUND: nope' } }) + '\n',
      );
    });

    await expect(client.request('features.get', { featureId: 'nope' })).rejects.toThrow('FEATURE_NOT_FOUND');
    client.dispose();
  });

  it('supports concurrent requests resolved by id', async () => {
    const { serverIn, serverOut, client } = harness();
    const reader = createInterface({ input: serverIn, crlfDelay: Infinity });
    reader.on('line', (line) => {
      const req = JSON.parse(line) as { id: number; method: string };
      serverOut.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: `${req.method}:${req.id}` }) + '\n');
    });

    const [a, b, c] = await Promise.all([
      client.request<string>('one'),
      client.request<string>('two'),
      client.request<string>('three'),
    ]);
    expect([a, b, c]).toEqual(['one:1', 'two:2', 'three:3']);
    client.dispose();
  });

  it('rejects pending requests on dispose', async () => {
    const { client } = harness();
    const pending = client.request('never');
    client.dispose();
    await expect(pending).rejects.toThrow('service is closed');
  });

  it('rejects requests made after dispose', async () => {
    const { client } = harness();
    client.dispose();
    await expect(client.request('later')).rejects.toThrow('closed');
  });
});
