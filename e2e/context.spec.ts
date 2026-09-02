/**
 * v0.7.0 Web API Loop E2E — Milestone 25 §Stage 4.
 *
 * Drives the thin Web Context panel end-to-end against the real HTTP
 * API: Feature Detail → AI Context → Build → Recommended Files →
 * Markdown Preview → Copy (canonical markdown lands on the clipboard).
 */
import { expect, test, type Page } from '@playwright/test';

// navigator.clipboard needs read/write permissions in the test context.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openContextPanel(page: Page) {
  await page.goto('/features/feature%3Alogin');
  await page.getByRole('button', { name: 'AI Context' }).click();
}

test('AI Context panel builds and previews the canonical document', async ({ page }) => {
  await openContextPanel(page);
  await page.getByRole('button', { name: 'Build' }).click();
  await expect(page.getByRole('heading', { name: 'Recommended Files' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Markdown Preview' })).toBeVisible();
  // The canonical markdown (single renderer) is previewed verbatim.
  await expect(page.getByText('# Feature Context: Login').first()).toBeVisible();
  await expect(page.getByText('## Core Code').first()).toBeVisible();
  // Recommended files list paths in monospace.
  await expect(page.getByText(/src\/.*\.(ts|tsx|js)/).first()).toBeVisible();
});

test('AI Context panel is task-aware (task only re-ranks)', async ({ page }) => {
  await openContextPanel(page);
  await page.getByPlaceholder(/Task/).fill('refresh token rotation');
  await page.getByRole('button', { name: 'Build' }).click();
  await expect(page.getByText('## Task').first()).toBeVisible();
  await expect(page.getByText('refresh token rotation').first()).toBeVisible();
});

test('Copy writes the canonical markdown to the clipboard verbatim', async ({ page }) => {
  await openContextPanel(page);
  await page.getByRole('button', { name: 'Build' }).click();
  await expect(page.getByRole('heading', { name: 'Markdown Preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('# Feature Context: Login');
  expect(clip).toContain('## Recommended Files');
});
