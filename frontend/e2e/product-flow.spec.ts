import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (r) => r.abort());
});
test("first use explains the product and supports try, review, save and reopen without sign-in", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__micCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__micCalls++;
      throw new Error("No automatic microphone access");
    };
  });
  await page.goto("/");
  await expect(
    page.getByText(/OneBrain is your voice-first assistant for notes/),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "How OneBrain works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "List", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Try a note", exact: true }).click();
  await expect(page.locator(".record-row")).toHaveCount(0);
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("Maya prefers a call before lunch");
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Review your capture" }),
  ).toContainText("Maya prefers a call before lunch");
  await expect(page.locator(".record-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Save 1 item", exact: true }).click();
  await expect(page.locator(".record-row")).toContainText(
    "Maya prefers a call before lunch",
  );
  await expect(
    page.getByRole("button", { name: "Try a note", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page.locator(".record-row").click();
  await expect(
    page.getByRole("dialog", { name: "The full context" }),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Maya prefers a call before lunch",
  );
  expect(await page.evaluate(() => (window as any).__micCalls)).toBe(0);
});
for (const width of [320, 390, 768, 1440])
  test(`only two main destinations, responsive at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link")).toHaveCount(2);
    await expect(
      nav.getByRole("link", { name: "Today", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await nav.getByRole("link", { name: "Your space", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Your space/ }),
    ).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByLabel("Find a tool or setting").fill("calendar");
    await expect(page.locator(".control-entry")).toHaveCount(1);
    await page
      .getByRole("link", { name: /Connected work Shared workspaces/ })
      .click();
    await expect(page).toHaveURL(/control\?panel=shared$/);
    await expect(
      page.getByRole("button", { name: "Continue with Google", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("tool search, inline navigation and browser Back keep a clear location", async ({
  page,
}) => {
  await page.goto("/control");
  await page.getByLabel("Find a tool or setting").fill("no-such-tool");
  await expect(
    page.getByRole("heading", { name: "No matching tools" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all tools" }).click();
  await page
    .getByRole("link", { name: /Voice & conversation Language/ })
    .click();
  await expect(page).toHaveURL(/control\?panel=voice$/);
  await page.getByRole("checkbox", { name: /^Silent Mode/ }).check();
  await page.goBack();
  await expect(page).toHaveURL(/control$/);
  await page
    .getByRole("link", { name: /Voice & conversation Language/ })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /^Silent Mode/ }),
  ).toBeChecked();
  await page.goto("/control?panel=constructor");
  await expect(page.getByRole("status")).toContainText("wasn’t found");
});
test("reminders can be created, restored and dismissed inside Your space", async ({
  page,
}) => {
  await page.goto("/control?panel=reminders");
  await page
    .getByLabel("What should I remind you about?")
    .fill("Review the proposal");
  await page.getByLabel("Time", { exact: true }).fill("15:30");
  await page.getByLabel("Date · optional", { exact: true }).fill("2099-09-15");
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  await expect(page.locator(".reminder-list")).toContainText(
    "Review the proposal",
  );
  await page.reload();
  await expect(page.locator(".reminder-list")).toContainText("2099-09-15");
  await page
    .getByRole("button", { name: "Dismiss Review the proposal" })
    .click();
  await expect(page.locator(".reminder-list")).not.toContainText(
    "Review the proposal",
  );
});
test("the question flow returns an answer next to the composer, with reduced motion supported", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Choose question mode" }).click();
  await page.getByLabel("Capture a thought", { exact: true }).fill("25 + 15");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "OneBrain response" }),
  ).toContainText("40");
  await page.getByRole("button", { name: "Open settings" }).click();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeFocused();
});
test("sensitive panels load on demand without an AI SDK or microphone request", async ({
  page,
}) => {
  const providers: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("js.puter.com")) providers.push(r.url());
  });
  await page.addInitScript(() => {
    (window as any).__micCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__micCalls++;
      throw new Error("No automatic microphone access");
    };
  });
  await page.goto("/control");
  for (const panel of [
    "vault",
    "advanced",
    "privacy",
    "tools",
    "reminders",
    "memory",
    "memory-search",
    "timeline",
    "conversations",
  ]) {
    await page.goto("/control?panel=" + panel);
    await expect(page.locator(".control-panel")).toBeVisible();
    await expect(page.locator(".panel-loading")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__micCalls)).toBe(0);
  }
  expect(providers).toEqual([]);
});

test("notification permission is requested only after an explicit action", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__notificationRequests = 0;
    Object.defineProperty(Notification, "requestPermission", {
      value: async () => {
        (window as any).__notificationRequests++;
        return "granted";
      },
    });
  });
  await page.goto("/control?panel=reminders");
  await expect(
    page.getByRole("button", {
      name: "Enable browser notifications",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__notificationRequests),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Enable browser notifications", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Browser notifications enabled",
  );
  expect(
    await page.evaluate(() => (window as any).__notificationRequests),
  ).toBe(1);
});
