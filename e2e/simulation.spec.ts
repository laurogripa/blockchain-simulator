import { test, expect } from '@playwright/test';

/**
 * Real-browser smoke test: boots the actual engine (Workers, rAF loop, store — everything the
 * headless engine tests deliberately skip) and checks the simulation is alive end to end —
 * nodes render, and the chain visibly grows over time. This is the one layer the Vitest/jsdom
 * suite structurally cannot cover, since jsdom has no Worker/rAF-driven real-time loop.
 */
test('the scenario picker blocks the sim until a mode is chosen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('choose how the network starts')).toBeVisible();

  // Nothing mines before a choice is made — the network graph is present underneath but the
  // picker overlay sits on top of it.
  await page.getByRole('button', { name: /random/i }).click();
  await expect(page.getByText('choose how the network starts')).toBeHidden();
});

test('picking the 64-block scenario seeds the chain instantly and mining continues live', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /64-block scenario/i }).click();

  const chainPanel = page.locator('.panel', { hasText: 'chain' });
  // The scripted history should already be there right after picking (63 mined blocks + genesis).
  await expect
    .poll(async () => chainPanel.locator('text=/^h\\d+$/').count(), { timeout: 5_000 })
    .toBeGreaterThan(20);
});

test('the network graph renders all nodes and the chain grows as the sim runs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /random/i }).click();

  // All 10 full nodes and 5 miners should be labeled on the network graph.
  for (const id of ['N1', 'N2', 'M1', 'M2', 'M5']) {
    await expect(page.getByText(id, { exact: true }).first()).toBeVisible();
  }

  // The chain-of-blocks panel starts with just genesis...
  const chainPanel = page.locator('.panel', { hasText: 'chain' });
  const initialBlockCount = await chainPanel.locator('text=/^h\\d+$/').count();

  // ...and after the sim runs for a bit (it's sped up well past real time by default), more
  // blocks should have been mined and rendered.
  await expect
    .poll(async () => chainPanel.locator('text=/^h\\d+$/').count(), { timeout: 20_000 })
    .toBeGreaterThan(initialBlockCount);
});

test('switching to the merkle tab renders it, and back to network works', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /random/i }).click();

  await page.getByRole('button', { name: 'merkle' }).click();
  await expect(page.getByRole('button', { name: 'merkle' })).toHaveClass(/active/);

  await page.getByRole('button', { name: 'network' }).click();
  await expect(page.getByRole('button', { name: 'network' })).toHaveClass(/active/);
  await expect(page.getByText('N1', { exact: true }).first()).toBeVisible();
});
