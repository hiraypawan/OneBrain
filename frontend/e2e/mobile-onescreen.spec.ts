import { test, expect } from "@playwright/test";

// Mobile is one app screen per tab: Today fits its viewport with no page
// scroll; secondary panels swipe horizontally instead of stacking.
test("mobile Today fits one screen, panels swipe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /good|still awake/i }).first()).toBeVisible();
  // Fold content is visible without scrolling.
  await expect(page.getByRole("button", { name: "Try a note", exact: true })).toBeVisible();
  // No vertical page scroll in the default state.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
  ).toBe(true);
  // Panels sit in a horizontal rail, never a vertical stack: the rail may
  // scroll sideways, but it must not widen the page itself.
  const rail = page.locator(".today-panels");
  await expect(rail).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  // Footer compresses to its actions on phones (tagline tucks away).
  await expect(page.locator(".home-footer p")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open settings" })).toBeVisible();
});
