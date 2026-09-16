import { expect, test } from "@playwright/test";

// The acceptance bar for this release was "expenses findable in under ten
// seconds, from a cold app, on a phone". These tests hold that line and keep
// the Track tab's promises honest: an empty window says so, every figure comes
// from the log the user made, and the numbers export cleanly.

const today = () => new Date().toISOString().slice(0, 10);

async function logExpense(page: import("@playwright/test").Page, text: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose question mode" }).click();
  await page.getByLabel("Capture a thought", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  // The deterministic log path answers with the number it stored — no AI call,
  // no network, so this works with the provider offline.
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText(/\d/);
}

test("an expense spoken on Today is findable in Track in under ten seconds", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const started = Date.now();
  await logExpense(page, "kharcha 250 diesel");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Track", exact: true }).click();
  await expect(page).toHaveURL(/track\?lens=expenses/);
  await expect(
    page.getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const spent = page.locator(".track-stat").filter({ hasText: "Spent" });
  await expect(spent).toContainText("₹250");
  await expect(page.locator(".track-budget-head")).toContainText(/no monthly limit|of ₹/);
  expect(Date.now() - started, "cold app to the number, on a phone viewport").toBeLessThan(10000);
  // and it is the same figure the log holds, in the per-item list
  await expect(page.locator(".track-item").first()).toContainText("₹250");
});

test("an empty window is answered honestly, with no invented rows", async ({
  page,
}) => {
  await page.goto("/track?lens=expenses&range=month&day=2026-01-05");
  // A zero is printed as a zero, and the card says what is missing instead of
  // quietly hiding itself.
  await expect(page.getByText("Nothing in this window")).toBeVisible();
  await expect(page.locator(".track-item")).toHaveCount(0);
  await expect(page.locator(".track-stat").filter({ hasText: "Spent" })).toContainText("₹0");
  await expect(page.locator(".track-empty-bars")).toBeVisible();
});

test("the lens and window live in the URL, so Back works and links can be shared", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Track", exact: true }).click();
  await page.getByRole("button", { name: "Food", exact: true }).click();
  await expect(page).toHaveURL(/lens=food/);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/range=day/);
  await page.goBack();
  await expect(page).toHaveURL(/lens=food&range=day/);
  // A garbage URL must not blank the page: it falls back to the default view.
  await page.goto("/track?lens=constructor&range=9999");
  await expect(
    page.getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a Track answer on Today deep-links into the tab, and the log can leave as CSV", async ({
  page,
}) => {
  await logExpense(page, "kharcha 100 chai");
  await page.getByRole("button", { name: "Choose question mode" }).click();
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("what expenses did I do this month");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  const link = page.getByRole("link", { name: "View in Track →" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/track\?lens=expenses&range=month/);
  await expect(
    page.getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /as CSV$/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^onebrain-expenses-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await file.path();
  const text = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  const [header, ...rows] = text.trim().split("\n");
  expect(header).toBe("day,time,kind,label,qty,unit,calories,amount,currency,category");
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0]).toContain(today());
  expect(rows[0]).toContain("Food & drink");
});

test("food stays labelled as an estimate and health keeps its disclaimer", async ({
  page,
}) => {
  await logExpense(page, "2 roti khayi");
  await page.goto("/track?lens=food&range=day");
  await expect(page.locator(".track-meals").first()).toContainText("≈");
  await expect(page.getByText(/rough home-style estimate/, { exact: false })).toBeVisible();
  await page.goto("/track?lens=health&range=week");
  await expect(page.getByText(/not a diagnosis/, { exact: false })).toBeVisible();
});

test("the To-Do list merges what was saved where, without a fourth store", async ({
  page,
}) => {
  // Save a task the way the canvas does it — review, then save.
  await page.goto("/");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("task: Renew the passport");
  await page.getByRole("button", { name: "Review capture", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Review your capture" }),
  ).toContainText("Renew the passport");
  await page.getByRole("button", { name: "Save 1 item", exact: true }).click();
  await expect(page.locator(".record-row")).toContainText("Renew the passport");

  // The same item now appears in the unified list, with its origin named.
  await page.goto("/control?panel=tasks");
  const row = page.locator(".todo-row").filter({ hasText: "Renew the passport" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("saved here");
  await row.getByLabel("Complete Renew the passport").click();
  await expect(page.locator(".todo-row.is-done")).toContainText("Renew the passport");

  // Completion wrote back to the canvas record — it survives a reload, and
  // Today still shows the same row. There is no second copy to fall out of sync.
  await page.reload();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".todo-row.is-done")).toContainText("Renew the passport");
  await page.goto("/");
  await expect(page.locator(".record-row")).toContainText("Renew the passport");
});

test("one search box finds saved things and retires old panel URLs without dead ends", async ({
  page,
}) => {
  await page.goto("/control");
  await page.getByLabel("Find a tool or setting").fill("passport");
  await expect(page.getByRole("region", { name: "In your saved things" })).toContainText(
    "Renew the passport",
  );
  // Every retired door still opens something: the URL redirects instead of 404.
  await page.goto("/control?panel=track");
  await expect(page).toHaveURL(/\/track/);
  await page.goto("/control?panel=notes");
  await expect(page).toHaveURL(/\/(\?|$)/);
  await page.goto("/control?panel=to-do");
  await expect(page).toHaveURL(/control\?panel=tasks$/);
});
