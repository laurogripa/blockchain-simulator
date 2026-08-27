import { test, expect } from '@playwright/test';

test.setTimeout(240_000); // the expects below wait up to 60s+60s+120s

test('the Fork scenario produces two rival blocks at one height, then resolves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /random/i }).click();
  await page.getByRole('button', { name: /^fork$/i }).click();

  const log = page.locator('body');
  // first solver announces while the rival is still grinding...
  await expect(log.getByText(/keeps grinding the same parent/)).toBeVisible({ timeout: 60_000 });
  // ...then the rival finds its own before the first block reaches it
  await expect(log.getByText(/solves its own h\d+/)).toBeVisible({ timeout: 60_000 });
  // and the tie is broken by a later block
  await expect(log.getByText(/fork at h\d+ resolved/)).toBeVisible({ timeout: 120_000 });
});
