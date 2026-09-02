/**
 * Minimal JSON-RPC 2.0 over newline-delimited stdio (ADR-0008 §3).
 *
 * The FeatureMap IDE service speaks a tiny JSON-RPC 2.0 dialect over
 * stdio: one JSON object per line. v0.6 uses requests/responses only;
 * notifications (no id) are dispatched without a reply, leaving room
 * for future progress events. No HTTP port is ever opened (ADR-0008
 * §3 — no loopback auth surface, no manual server start).
 */
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export type RpcId = number | string | null;

export interface RpcRequest {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcSuccessResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result: unknown;
}

export interface RpcErrorResponse {
  jsonrpc: '2.0';
  id: RpcId;
  error: { code: number; message: string; data?: unknown };
}

/** JSON-RPC 2.0 standard error codes (spec §5.1). */
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;

/**
 * Domain-level error range for application errors (JSON-RPC reserves
 * -32000..-32099 for server errors). `code` is a stable string prefix
 * so consumers can branch without parsing prose.
 */
export const DomainErrorCode = -32000;

/** Error whose code is propagated over the wire as a JSON-RPC error. */
export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Parse and validate one JSON-RPC request line. */
export function parseRequestLine(line: string): RpcRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new RpcError(RpcErrorCode.ParseError, 'Invalid JSON payload.');
  }
  if (raw === null || typeof raw !== 'object') {
    throw new RpcError(RpcErrorCode.InvalidRequest, 'Request must be a JSON object.');
  }
  const req = raw as Record<string, unknown>;
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string' || req.method === '') {
    throw new RpcError(RpcErrorCode.InvalidRequest, 'Request requires jsonrpc "2.0" and a non-empty method.');
  }
  const id = req.id === undefined ? null : req.id;
  if (id !== null && typeof id !== 'number' && typeof id !== 'string') {
    throw new RpcError(RpcErrorCode.InvalidRequest, 'Request id must be a number, string or null.');
  }
  return { jsonrpc: '2.0', id, method: req.method, params: req.params };
}

export function encodeResponse(response: RpcSuccessResponse | RpcErrorResponse): string {
  return JSON.stringify(response) + '\n';
}

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

export interface RpcWriter {
  write(text: string): void;
}

/**
 * Serve JSON-RPC requests from a readable stream, writing responses to
 * the writer. One request per line; unknown methods get a
 * MethodNotFound reply; handler failures become InternalError replies
 * (or the handler's own RpcError code). Returns when the input closes.
 */
export async function serveRpc(
  handlers: Record<string, RpcHandler>,
  input: Readable,
  output: RpcWriter,
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    let id: RpcId = null;
    let notification = false;
    try {
      const request = parseRequestLine(line);
      id = request.id;
      notification = id === null;
      const handler = handlers[request.method];
      if (!handler) {
        if (!notification) {
          output.write(
            encodeResponse({
              jsonrpc: '2.0',
              id,
              error: { code: RpcErrorCode.MethodNotFound, message: `Unknown method: ${request.method}` },
            }),
          );
        }
        continue;
      }
      const result = await handler(request.params);
      if (!notification) {
        output.write(encodeResponse({ jsonrpc: '2.0', id, result: result ?? null }));
      }
    } catch (err) {
      const e =
        err instanceof RpcError
          ? err
          : new RpcError(RpcErrorCode.InternalError, err instanceof Error ? err.message : String(err));
      if (!notification) {
        output.write(encodeResponse({ jsonrpc: '2.0', id, error: { code: e.code, message: e.message } }));
      }
    }
  }
}
