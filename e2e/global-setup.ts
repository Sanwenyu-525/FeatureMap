import { execSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

/**
 * Global setup: ensure the fixture is scanned and the Web UI is built,
 * so `featuremap dev` serves real data and the static frontend.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  execSync('node ../../apps/cli/dist/index.js scan', {
    cwd: 'test-fixtures/react-express-basic',
    stdio: 'inherit',
  });
  execSync('pnpm --filter @featuremap/web build', { stdio: 'inherit' });
}
