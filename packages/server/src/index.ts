/**
 * @featuremap/server — local Fastify API.
 */
export * from './dto.js';
export * from './app.js';

import { buildServer, type BuildServerOptions } from './app.js';

/** Start the local API bound to loopback (docs/API_SPEC.md §1). */
export async function startServer(options: BuildServerOptions): Promise<{ port: number }> {
  const app = buildServer(options);
  await app.listen({ port: 7331, host: '127.0.0.1' });
  return { port: 7331 };
}

export { buildServer, type BuildServerOptions };
