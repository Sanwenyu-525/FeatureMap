/**
 * JSON-RPC 2.0 framing and dispatch over stdio (ADR-0008 §3).
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  RpcError,
  RpcErrorCode,
  encodeResponse,
  parseRequestLine,
  serveRpc,
  type RpcHandler,
} from '../src/rpc.js';

describe('parseRequestLine', () => {
  it('parses a valid request', () => {
    const req = parseRequestLine('{"jsonrpc":"2.0","id":1,"method":"features.list","params":{}}');
    expect(req.id).toBe(1);
    expect(req.method).toBe('features.list');
    expect(req.params).toEqual({});
  });

  it('treats a missing id as a notification (null)', () => {
    const req = parseRequestLine('{"jsonrpc":"2.0","method":"ping"}');
    expect(req.id).toBeNull();
  });

  it('rejects malformed JSON with a ParseError', () => {
    try {
      parseRequestLine('not json');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      expect((err as RpcError).code).toBe(RpcErrorCode.ParseError);
    }
  });

  it('rejects non-object payloads with an InvalidRequest', () => {
    try {
      parseRequestLine('42');
      expect.unreachable();
    } catch (err) {
      expect((err as RpcError).code).toBe(RpcErrorCode.InvalidRequest);
    }
  });

  it('rejects a request without a method', () => {
    try {
      parseRequestLine('{"jsonrpc":"2.0","id":1}');
      expect.unreachable();
    } catch (err) {
      expect((err as RpcError).code).toBe(RpcErrorCode.InvalidRequest);
    }
  });
});

describe('encodeResponse', () => {
  it('round-trips a success response as a single line', () => {
    expect(encodeResponse({ jsonrpc: '2.0', id: 1, result: { ok: true } })).toBe(
      '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n',
    );
  });
});

describe('serveRpc', () => {
  function runServer(handlers: Record<string, RpcHandler>): {
    input: PassThrough;
    outLines: string[];
    done: Promise<void>;
  } {
    const input = new PassThrough();
    const outLines: string[] = [];
    const done = serveRpc(handlers, input, { write: (text) => outLines.push(text) });
    return { input, outLines, done };
  }

  it('dispatches a request and writes the JSON-RPC response', async () => {
    const { input, outLines, done } = runServer({
      add: (params) => {
        const { a, b } = params as { a: number; b: number };
        return a + b;
      },
    });
    input.write('{"jsonrpc":"2.0","id":1,"method":"add","params":{"a":2,"b":3}}\n');
    input.end();
    await done;
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0]!)).toEqual({ jsonrpc: '2.0', id: 1, result: 5 });
  });

  it('answers unknown methods with MethodNotFound', async () => {
    const { input, outLines, done } = runServer({});
    input.write('{"jsonrpc":"2.0","id":7,"method":"nope"}\n');
    input.end();
    await done;
    expect(JSON.parse(outLines[0]!).error.code).toBe(RpcErrorCode.MethodNotFound);
  });

  it('wraps handler failures as errors with the request id', async () => {
    const { input, outLines, done } = runServer({
      boom: () => {
        throw new Error('kaboom');
      },
    });
    input.write('{"jsonrpc":"2.0","id":9,"method":"boom"}\n');
    input.end();
    await done;
    const parsed = JSON.parse(outLines[0]!);
    expect(parsed.id).toBe(9);
    expect(parsed.error.code).toBe(RpcErrorCode.InternalError);
    expect(parsed.error.message).toContain('kaboom');
  });

  it('propagates handler RpcError codes', async () => {
    const { input, outLines, done } = runServer({
      domain: () => {
        throw new RpcError(-32000, 'FEATURE_NOT_FOUND: nope');
      },
    });
    input.write('{"jsonrpc":"2.0","id":3,"method":"domain"}\n');
    input.end();
    await done;
    expect(JSON.parse(outLines[0]!).error.code).toBe(-32000);
  });

  it('dispatches notifications without replying', async () => {
    let calls = 0;
    const { input, outLines, done } = runServer({
      ping: () => {
        calls += 1;
      },
    });
    input.write('{"jsonrpc":"2.0","method":"ping"}\n');
    input.end();
    await done;
    expect(calls).toBe(1);
    expect(outLines).toHaveLength(0);
  });

  it('ignores blank lines', async () => {
    const { input, outLines, done } = runServer({
      pong: () => 'pong',
    });
    input.write('\n');
    input.write('{"jsonrpc":"2.0","id":2,"method":"pong"}\n');
    input.end();
    await done;
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0]!).result).toBe('pong');
  });
});
