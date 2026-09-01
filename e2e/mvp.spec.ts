/**
 * MVP acceptance E2E — docs/TESTING_STRATEGY.md §7 and docs/MVP_SPEC.md §12.
 *
 * 1. opening Overview
 * 2. browsing feature list
 * 3. opening Feature Detail
 * 4. viewing evidence explanation
 * 5. viewing current branch impact
 */
import { expect, test } from '@playwright/test';

test('Overview shows detected technologies and counts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'react-express-basic' })).toBeVisible();
  await expect(page.getByText('Files', { exact: true })).toBeVisible();
  await expect(page.getByText('Endpoints', { exact: true })).toBeVisible();
  await expect(page.getByText('express', { exact: true })).toBeVisible();
});

test('feature list shows the discovered Login feature', async ({ page }) => {
  await page.goto('/features');
  const login = page.getByRole('link', { name: 'Login' });
  await expect(login).toBeVisible();
  await expect(page.getByText('Authentication').first()).toBeVisible();
});

test('Feature Detail shows the product flow and health', async ({ page }) => {
  await page.goto('/features');
  await page.getByRole('link', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/features\/feature/);
  // Product flow view is the default with the xyflow canvas present.
  await expect(page.getByText('Why? — evidence explanation')).toBeVisible();
  await expect(page.getByText('implementation', { exact: true })).toBeVisible();
});

test('evidence explanation panel answers the Why? question', async ({ page }) => {
  await page.goto('/features/feature%3Alogin');
  // Switch to the engineering list view for deterministic assertions.
  await page.getByRole('button', { name: 'Engineering view' }).click();
  await expect(page.getByText('Evidence ("Why?")')).toBeVisible();
  // Feature membership evidence carries confidence and analyzer identity.
  await expect(page.getByText(/BELONGS_TO_FEATURE/).first()).toBeVisible();
  await expect(page.getByText(/feature-engine/).first()).toBeVisible();
});

test('changes page shows the current branch impact section', async ({ page }) => {
  await page.goto('/changes');
  await expect(page.getByText('Affected features')).toBeVisible();
  // The fixture working tree is clean: expect the empty state.
  await expect(page.getByText('No uncommitted changes in the working tree.')).toBeVisible();
});
