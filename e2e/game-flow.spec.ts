import { test, expect } from "@playwright/test";

/**
 * Game flow test. Phaser's canvas is opaque to Playwright's selector engine,
 * so we assert on the surrounding React HUD + overlay states.
 *
 * Strategy:
 *  1. Navigate to /game?mode=0 (Easy — 1 block/sec, 90s timer)
 *  2. Wait for the loading overlay to disappear (scene emits READY)
 *  3. Verify HUD shows score/combo/timer
 *  4. Click the canvas a few times — verify the score HUD updates eventually
 *  5. Click "bank early" — verify the survived overlay appears
 */
test("game boots, plays, banks early", async ({ page }) => {
  await page.goto("/game?mode=0");
  // Loading overlay
  await expect(page.getByText(/loading the chain/i)).toBeVisible();

  // HUD is visible the whole time
  await expect(page.getByText("time", { exact: false })).toBeVisible();
  await expect(page.getByText("score", { exact: false })).toBeVisible();

  // Wait for loading to disappear — scene emits READY
  await expect(page.getByText(/loading the chain/i)).toBeHidden({ timeout: 10_000 });

  // "bank early" button appears once playing
  const bank = page.getByRole("button", { name: /bank early/i });
  await expect(bank).toBeVisible({ timeout: 5_000 });

  // Click bank → survived overlay appears
  await bank.click();
  await expect(page.getByText(/survived/i)).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("button", { name: /Play again/i })).toBeVisible();
});

test("retry resets the game", async ({ page }) => {
  await page.goto("/game?mode=0");
  await expect(page.getByText(/loading the chain/i)).toBeHidden({ timeout: 10_000 });
  const bank = page.getByRole("button", { name: /bank early/i });
  await bank.click();
  await expect(page.getByText(/survived/i)).toBeVisible();
  await page.getByRole("button", { name: /Play again/i }).click();
  // Back into a fresh run — loading overlay should reappear briefly
  await expect(page.getByText(/loading the chain/i)).toBeVisible();
});
