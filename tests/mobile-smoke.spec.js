const { test, expect } = require("@playwright/test");

test("mobile shell loads core UI without page scrolling", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#enemy-summary")).toBeVisible();
  await expect(page.locator(".sequence-panel")).toBeVisible();
  await expect(page.locator(".action-panel")).toBeVisible();
  await expect(page.locator(".hand-panel")).toBeVisible();

  const viewportFits = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    return root.scrollHeight <= root.clientHeight + 1;
  });

  expect(viewportFits).toBe(true);
});

test("mobile action panel stays above the hand tray", async ({ page }) => {
  await page.goto("/");

  const actionBox = await page.locator(".action-panel").boundingBox();
  const handBox = await page.locator(".hand-panel").boundingBox();

  expect(actionBox).not.toBeNull();
  expect(handBox).not.toBeNull();
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(handBox.y + 1);
});
