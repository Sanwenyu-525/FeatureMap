/**
 * GitHub App authentication & webhook verification (Phase 4 / ADR-0007 §1–§2).
 *
 * A GitHub App authenticates in two steps:
 *   1. A short-lived RS256 JWT signed with the app's private key
 *      (`createAppJwt`) — issuer is the app id, lifetime ≤ 10 minutes.
 *   2. The JWT exchanges for an installation access token
 *      (`getInstallationToken`) via `POST /app/installations/{id}/access_tokens`.
 *
 * Webhook payloads are verified with an HMAC-SHA256 of the raw body
 * (`verifyWebhookSignature`, constant-time compare) using the app's
 * webhook secret. The private key and secret are read from the
 * environment/deployment, never logged.
 */
import { createHmac, createSign, timingSafeEqual } from 'node:crypto';

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

/** Create an app JWT (RS256). `now` is injectable for tests. */
export function createAppJwt(appId: string, privateKey: string, now: number = Date.now()): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const payload = b64url(JSON.stringify({ iat, exp: iat + 10 * 60, iss: appId }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  sign.end();
  const signature = sign.sign(privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a GitHub webhook `X-Hub-Signature-256` header against the raw
 * request body (constant-time compare). Returns false on missing/malformed
 * headers so callers can respond 401 without throwing.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface InstallationToken {
  token: string;
  /** ISO timestamp; providers cache until shortly before expiry. */
  expiresAt: string;
}

export interface GetInstallationTokenOptions {
  jwt: string;
  installationId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Exchange an app JWT for an installation access token. */
export async function getInstallationToken(
  options: GetInstallationTokenOptions,
): Promise<InstallationToken> {
  const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const impl = options.fetchImpl ?? fetch;
  const response = await impl(`${baseUrl}/app/installations/${options.installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'featuremap/0.0.1',
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub installation token exchange failed: ${response.status} ${response.statusText}`,
    );
  }
  const json = (await response.json()) as { token?: string; expires_at?: string };
  if (!json.token) throw new Error('GitHub installation token response missing "token".');
  return { token: json.token, expiresAt: json.expires_at ?? '' };
}
