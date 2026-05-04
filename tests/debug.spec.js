const { test, expect } = require("@playwright/test");

test("debug control room loads live match tools", async ({ page }) => {
  await page.goto("/debug/");

  await expect(page.getByRole("heading", { name: "UnderCard Debug Control Room" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start New Match" })).toBeVisible();
  await expect(page.locator("#match-summary-grid")).toBeVisible();
  await expect(page.locator("#player-editor-player")).toBeVisible();
  await expect(page.locator("#player-editor-enemy")).toBeVisible();
  await expect(page.locator("#ai-insight")).toBeVisible();
});
