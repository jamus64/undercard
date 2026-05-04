const { test, expect } = require("@playwright/test");

test("hand menu exposes deck and enemy hand inspectors", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Open hand menu" }).click();
  await expect(page.getByRole("button", { name: "See My Deck" })).toBeVisible();
  await expect(page.getByRole("button", { name: "See Enemy Hand" })).toBeVisible();

  await page.getByRole("button", { name: "See My Deck" }).click();
  await expect(page.locator("#hand-inspector-title")).toHaveText("See My Deck");
  await expect(page.locator("#hand-inspector-summary")).toContainText("Top of draw pile first");

  await page.locator("#close-hand-inspector-button").click();
  await page.getByRole("button", { name: "Open hand menu" }).click();
  await page.getByRole("button", { name: "See Enemy Hand" }).click();
  await expect(page.locator("#hand-inspector-title")).toHaveText("Enemy Hand");
  await expect(page.locator("#hand-inspector-summary")).toContainText("currently has");
});
