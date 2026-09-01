/**
 * App auth tests — JWT, webhook signature, installation token
 * (Phase 4 / ADR-0007 §1–§2). Cryptographic checks use an ephemeral
 * RSA key; no network.
 */
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAppJwt, getInstallationToken, verifyWebhookSignature } from '../src/app-auth.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

describe('createAppJwt', () => {
  it('mints an RS256 JWT with app id issuer and 10-minute lifetime', () => {
    const now = Date.UTC(2026, 0, 1);
    const jwt = createAppJwt('12345', privateKey, now);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);

    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { alg: string };
    expect(header.alg).toBe('RS256');

    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe('12345');
    expect(payload.exp - payload.iat).toBe(600);
  });

  it('signs with the private key such that the public key verifies', () => {
    const jwt = createAppJwt('12345', privateKey, Date.now());
    const [h, p, s] = jwt.split('.') as [string, string, string];
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'webhook-secret';
  const body = '{"action":"opened","pull_request":{}}';
  const good = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a correct HMAC-SHA256 signature', () => {
    expect(verifyWebhookSignature(secret, body, good)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(secret, body, 'sha256=deadbeef')).toBe(false);
  });

  it('rejects a missing or wrong-algorithm header', () => {
    expect(verifyWebhookSignature(secret, body, undefined)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'md5=abc')).toBe(false);
  });
});

describe('getInstallationToken', () => {
  it('exchanges a JWT for an installation token via the correct endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ token: 'inst-tok', expires_at: '2026-01-01T00:10:00Z' });
    }) as unknown as typeof fetch;

    const token = await getInstallationToken({ jwt: 'abc.def.ghi', installationId: '9', fetchImpl });

    expect(token.token).toBe('inst-tok');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.github.com/app/installations/9/access_tokens');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer abc.def.ghi');
  });

  it('throws when the token exchange fails', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'no' }, 401)) as unknown as typeof fetch;
    await expect(
      getInstallationToken({ jwt: 'j', installationId: '9', fetchImpl }),
    ).rejects.toThrow(/401/);
  });
});
