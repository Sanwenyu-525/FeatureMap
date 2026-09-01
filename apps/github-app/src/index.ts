/**
 * FeatureMap GitHub App webhook server (Phase 4 / ADR-0007).
 *
 * A thin Fastify shell over the testable webhook logic in
 * `@featuremap/scm`: verifies the `X-Hub-Signature-256` HMAC against
 * the raw body, resolves the installation id from the payload (org
 * install support), builds a `GitHubAppProvider` for the event, and
 * dispatches.
 *
 * Single-repo deployment shape for v0.4.2: `FEATUREMAP_GITHUB_OWNER`,
 * `FEATUREMAP_GITHUB_REPO` and `FEATUREMAP_REPO_ROOT` (a local checkout
 * of that repo) are configured once; the checkout is refreshed
 * out-of-band. Multi-repo checkout management is a later milestone.
 *
 * Environment:
 *   FEATUREMAP_GITHUB_APP_ID                  — app id
 *   FEATUREMAP_GITHUB_APP_PRIVATE_KEY_PATH    — PEM private key path
 *   FEATUREMAP_GITHUB_WEBHOOK_SECRET          — webhook secret
 *   FEATUREMAP_GITHUB_INSTALLATION_ID         — optional; defaults to
 *                                               the webhook payload
 *   FEATUREMAP_GITHUB_OWNER / _REPO           — target repository
 *   FEATUREMAP_REPO_ROOT                      — local checkout to scan
 *   FEATUREMAP_GITHUB_BASE_URL                — optional API override
 *   PORT                                      — listen port (default 7332)
 */
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import {
  GitHubAppProvider,
  handleWebhook,
  parseWebhookEvent,
  verifyWebhookSignature,
} from '@featuremap/scm';

interface AppEnv {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId?: string;
  owner: string;
  repo: string;
  repoRoot: string;
  baseUrl?: string;
  port: number;
}

function loadEnv(): AppEnv {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const privateKeyPath = required('FEATUREMAP_GITHUB_APP_PRIVATE_KEY_PATH');
  return {
    appId: required('FEATUREMAP_GITHUB_APP_ID'),
    privateKey: readFileSync(privateKeyPath, 'utf8'),
    webhookSecret: required('FEATUREMAP_GITHUB_WEBHOOK_SECRET'),
    installationId: process.env.FEATUREMAP_GITHUB_INSTALLATION_ID,
    owner: required('FEATUREMAP_GITHUB_OWNER'),
    repo: required('FEATUREMAP_GITHUB_REPO'),
    repoRoot: required('FEATUREMAP_REPO_ROOT'),
    baseUrl: process.env.FEATUREMAP_GITHUB_BASE_URL,
    port: Number(process.env.PORT ?? 7332),
  };
}

const env = loadEnv();
const app = Fastify({ logger: true });

// The webhook HMAC signs the RAW body, so parse as a buffer and let the
// handler decode it.
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

app.get('/health', async () => ({ ok: true }));

app.post('/webhook', async (request, reply) => {
  const raw = request.body as Buffer;
  const signature = request.headers['x-hub-signature-256'] as string | undefined;
  if (!verifyWebhookSignature(env.webhookSecret, raw, signature)) {
    return reply.code(401).send({ error: { code: 'BAD_SIGNATURE' } });
  }

  const text = raw.toString('utf8');
  const event = parseWebhookEvent(text);
  const installationId = env.installationId ?? String(event.installation?.id ?? '');
  if (!installationId) {
    return reply.code(400).send({ error: { code: 'MISSING_INSTALLATION' } });
  }

  const provider = new GitHubAppProvider({
    appId: env.appId,
    privateKey: env.privateKey,
    installationId,
    owner: env.owner,
    repo: env.repo,
    baseUrl: env.baseUrl,
  });

  const result = await handleWebhook(text, { repoRoot: env.repoRoot, provider, scan: true });
  return reply.send(result);
});

app.listen({ port: env.port, host: '0.0.0.0' }).then(() => {
  app.log.info(`FeatureMap GitHub App listening on :${env.port}`);
});
