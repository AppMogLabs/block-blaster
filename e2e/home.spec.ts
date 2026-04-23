import { test, expect } from "@playwright/test";

test("home renders with title and CTAs", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("BLOCK")).toBeVisible();
  await expect(page.getByText("BLASTER")).toBeVisible();
  await expect(page.getByText("The chain never stops.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Play as Guest/i })).toBeVisible();
  await expect(page.getByText(/Powered by MegaETH/i)).toBeVisible();
});

test("guest can reach difficulty select", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /Play as Guest/i }).click();
  await expect(page).toHaveURL(/\/difficulty/);
  await expect(page.getByText(/Pick your tempo/i)).toBeVisible();
  // All 4 modes visible
  for (const label of ["Easy", "Medium", "Hard", "Real-time"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
});

test("leaderboard renders with tab switcher", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Easy/i })).toBeVisible();
  await page.getByRole("button", { name: /Hard/i }).click();
  // No assertion on contents — contract may be unset in CI
});
