import { defineConfig } from '@playwright/test';

/**
 * E2E config — docs/TESTING_STRATEGY.md §7.
 *
 * The suite drives the real product loop: fixture scan → built Web UI
 * served by `featuremap dev` on the loopback port (docs/API_SPEC.md §1).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:7331',
  },
  webServer: {
    command: 'node ../../apps/cli/dist/index.js dev',
    cwd: 'test-fixtures/react-express-basic',
    url: 'http://127.0.0.1:7331/api/project',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
