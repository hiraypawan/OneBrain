import { expect, test } from "@playwright/test";

// The acceptance bar for this release was “expenses findable in under ten
// seconds, from a cold app, on a phone”. These tests hold that line and keep
// the Track tab's promises honest: an empty window says so, every figure comes
// from the log the user made, and the numbers leave the device cleanly.
//
// Each test starts from a fresh browser context, so anything a later step
// asserts has to be saved by that same test — nothing here inherits data.

const today = () => new Date().toISOString().slice(0, 10);

async function ask(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("button", { name: "Choose question mode" }).click();
  await page.getByLabel("Capture a thought", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
}

/** Log an expense the way a user says it. Deterministic: no AI call, so this
 *  passes with every provider offline, and the answer quotes the amount. */
async function logExpense(page: import("@playwright/test").Page, text: string) {
  await page.goto("/");
  await ask(page, text);
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText(
    "Logged",
    { timeout: 15000 },
  );
}

async function saveTask(page: import("@playwright/test").Page, title: string) {
  await page.goto("/");
  await page.getByLabel("Capture type").selectOption("task");
  await page.getByLabel("Capture a thought", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Review capture", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Review your capture" })).toContainText(
    title,
  );
  await page.getByRole("button", { name: "Save 1 item", exact: true }).click();
  await expect(page.locator(".record-row")).toContainText(title);
}

test("an expense spoken on Today is findable in Track in under ten seconds", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const started = Date.now();
  await logExpense(page, "kharcha 250 diesel");
  await page.getByRole("link", { name: "Track", exact: true }).click();
  await expect(page).toHaveURL(/\/track$/);
  await expect(page.getByRole("heading", { name: "Track" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".track-stat").filter({ hasText: "Spent" })).toContainText(
    "₹250",
  );
  // A monthly limit that was never set is named as missing, not drawn as zero.
  await expect(page.locator(".track-budget-head")).toContainText(/no monthly limit|of ₹/);
  expect(Date.now() - started, "cold app to the number, on a phone viewport").toBeLessThan(
    10000,
  );
  // …and the summary agrees with the per-item list it was computed from.
  await expect(page.locator(".track-item").first()).toContainText("₹250");
});

test("an empty window is answered honestly, with no invented rows", async ({ page }) => {
  await page.goto("/track?lens=expenses&range=month&day=2026-01-05");
  await expect(page.getByRole("heading", { name: "Track" })).toBeVisible();
  // A zero prints as a zero and the card says what is missing instead of
  // quietly hiding itself.
  await expect(page.getByText("Nothing in this window")).toBeVisible();
  await expect(page.locator(".track-item")).toHaveCount(0);
  await expect(page.locator(".track-stat").filter({ hasText: "Spent" })).toContainText("₹0");
});

test("the lens and window live in the URL, so Back works and links can be shared", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Track", exact: true }).click();
  await page.getByRole("button", { name: "Food diary", exact: true }).click();
  await expect(page).toHaveURL(/lens=food/);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/range=day/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/); // Back leaves Track …
  await page.goForward();
  await expect(page).toHaveURL(/lens=food/); // … and Forward returns to the same window.
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

test("a Track answer deep-links into the window it just described, and the log leaves as CSV", async ({
  page,
}) => {
  // Seeded through the Track form itself: this test is about the door the answer
  // opens, not about the log path (which has its own test above).
  await page.goto("/track?lens=expenses&range=month");
  await page.getByLabel("Amount").fill("100");
  await page.getByLabel("What for").fill("chai at the corner stall");
  await page.getByRole("button", { name: "Log expense" }).click();
  await expect(page.locator(".track-item").first()).toContainText("₹100");

  await page.goto("/");
  await ask(page, "what expenses did I do this month");
  const link = page.getByRole("link", { name: "View in Track →" });
  // One answer, one card, one door.
  await expect(link).toHaveCount(1);
  const href = await link.getAttribute("href");
  expect(href).toMatch(/\/track\?lens=expenses&range=month/);
  await link.click();
  await expect(
    page.getByRole("button", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".track-stat").filter({ hasText: "Spent" })).toContainText("₹100");

  // The export carries exactly the window on screen: header, then the row.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /as CSV$/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^onebrain-expenses-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const path = await file.path();
  const text = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  const [header, ...rows] = text.trim().split("\n");
  expect(header).toBe("day,time,kind,label,qty,unit,calories,amount,currency,category");
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows[0]).toContain(today());
  expect(rows[0]).toContain("100");
});

test("food stays labelled as an estimate and health keeps its disclaimer", async ({ page }) => {
  await logExpense(page, "2 roti khayi");
  await page.goto("/track?lens=food&range=day");
  await expect(page.locator(".track-meals").first()).toContainText("≈");
  await expect(page.getByText(/rough home-style estimate/)).toBeVisible();
  await page.goto("/track?lens=health&range=week");
  await expect(page.getByText(/not a diagnosis/)).toBeVisible();
});

test("the To-Do list merges what was saved where, without a fourth store", async ({ page }) => {
  await saveTask(page, "Renew the passport");

  // The same item now appears in the unified list, with its origin named.
  await page.goto("/control?panel=tasks");
  const row = page.locator(".todo-row").filter({ hasText: "Renew the passport" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("saved here");
  await row.getByLabel("Complete Renew the passport").click();
  await expect(page.locator(".todo-row.is-done")).toContainText("Renew the passport");

  // Completion wrote back to the canvas record: it survives a reload, and Today
  // still shows the same row. There is no second copy to fall out of sync.
  await page.reload();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".todo-row.is-done")).toContainText("Renew the passport");
  await page.goto("/");
  await expect(page.locator(".record-row")).toContainText("Renew the passport");
});

test("one search box finds saved things and retires old panel URLs without dead ends", async ({
  page,
}) => {
  await saveTask(page, "Renew the passport");

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
