import { test, expect } from "@playwright/test";
import { seedServerSession } from "./server-fixture";
test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (r) => r.abort());
});
test("sign-in is visible on a 320px home and settings have distinct destinations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Sign in with Google", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open settings" }).click();
  const shortcuts = page.getByRole("navigation", { name: "Settings sections" });
  await expect(shortcuts.getByRole("link")).toHaveCount(4);
  await shortcuts.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(/control\?panel=account$/);
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
  for (const [section, title] of [
    ["voice", "Voice & conversation"],
    ["privacy", "Memory & privacy"],
    ["advanced", "Advanced"],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .locator(`a[href="/control?panel=${section}"]`)
      .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(`[aria-current=page][href="/control?panel=${section}"]`),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/settings");
  await expect(page).toHaveURL(/control\?panel=account$/);
});
test("voice preferences are shared with quick settings and persist without microphone access", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__micRequests++;
      throw new Error("No implicit mic");
    };
  });
  await page.goto("/settings/voice");
  await page.getByRole("checkbox", { name: /^Proactive conversation/ }).check();
  await page.getByRole("checkbox", { name: /^Silent Mode/ }).check();
  await page
    .getByRole("combobox", { name: "Recognition language", exact: true })
    .selectOption("hi-IN");
  await page
    .getByRole("combobox", { name: "Answer length", exact: true })
    .selectOption("long");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Recognition language", exact: true }),
  ).toHaveValue("hi-IN");
  await expect(
    page.getByRole("combobox", { name: "Answer length", exact: true }),
  ).toHaveValue("long");
  expect(await page.evaluate(() => (window as any).__micRequests)).toBe(0);
  await page.goto("/");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Proactive conversation/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Silent Mode/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Recognition language", exact: true }),
  ).toHaveValue("hi-IN");
});
test("account is verified on the server; failed sign-out is not presented as success", async ({
  page,
}) => {
  await seedServerSession(page);
  await page.goto("/settings/account");
  await expect(
    page.getByText("GOOGLE ACCOUNT · SESSION VERIFIED"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Account settings", exact: true }),
  ).toBeVisible();
  await page.route("**/api/platform/logout", (r) =>
    r.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Sign-out could not be confirmed",
  );
  await expect(
    page.getByText("GOOGLE ACCOUNT · SESSION VERIFIED"),
  ).toBeVisible();
  await page.unroute("**/api/platform/logout");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
});
test("account check failures can retry and do not show a cached profile as authenticated", async ({
  page,
}) => {
  await page.route("**/api/platform/me", (r) =>
    r.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.goto("/settings/account");
  await expect(
    page.getByRole("heading", { name: "We couldn’t check your account" }),
  ).toBeVisible();
  await expect(page.getByText("GOOGLE ACCOUNT · SESSION VERIFIED")).toHaveCount(
    0,
  );
  await page.unroute("**/api/platform/me");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
});
test("advanced guards OAuth credentials and requests no microphone or provider on load", async ({
  page,
}) => {
  const providers: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://js.puter.com")) providers.push(r.url());
  });
  await page.addInitScript(() => {
    (window as any).__micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__micRequests++;
      throw new Error("Permission denied");
    };
  });
  await page.goto("/settings/advanced");
  await page.getByText("Configure a Gemini API key", { exact: true }).click();
  await page
    .getByLabel("Gemini API key", { exact: true })
    .fill("GOCSPX-test-only-not-a-real-secret");
  await page.getByRole("button", { name: "Save key locally" }).click();
  await expect(page.getByRole("status")).toContainText("not a Gemini API key");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("onebrain-settings") || "{}").apiKey,
    ),
  ).toBe("");
  await page
    .getByLabel("Gemini API key", { exact: true })
    .fill("AIza-test-only-key");
  await page.getByRole("button", { name: "Save key locally" }).click();
  await page.reload();
  await page.getByText("Configure a Gemini API key", { exact: true }).click();
  await expect(page.getByLabel("Gemini API key", { exact: true })).toHaveValue(
    "AIza-test-only-key",
  );
  await page.getByRole("button", { name: "Remove saved key" }).click();
  await expect(page.getByLabel("Gemini API key", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByText("Manage voice baseline & filter", { exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__micRequests)).toBe(0);
  await page.getByRole("button", { name: "Enroll my voice" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Microphone unavailable" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__micRequests)).toBe(1);
  expect(providers).toEqual([]);
});
test("privacy export and diagnostics use the settings shell on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  for (const route of ["privacy", "data-export", "debug"]) {
    await page.goto(`/settings/${route}`);
    await expect(
      page.getByRole("navigation", { name: "Settings sections" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/settings/data-export");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download local data (JSON)" })
    .click();
  expect((await download).suggestedFilename()).toBe("onebrain-data.json");
  await expect(page.getByRole("status")).toContainText("Export prepared");
});
test("Google availability distinguishes network failure from missing operator configuration", async ({
  page,
}) => {
  await page.route("**/api/platform/capabilities", (r) =>
    r.fulfill({ status: 503, json: { error: "offline" } }),
  );
  await page.goto("/auth/login");
  await expect(page.getByRole("status")).toContainText(
    "availability could not be checked",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeDisabled();
  await page.route("**/api/platform/capabilities", (r) =>
    r.fulfill({ json: { authMode: "google-only", configured: true } }),
  );
  await page.getByRole("button", { name: "Retry Google availability" }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeEnabled();
});

test("settings navigation starts a fresh document and leaves a loaded provider behind", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as any).__oldDocument = true;
    (window as any).puter = { testOnly: true };
  });
  await page.getByRole("link", { name: "Your space", exact: true }).click();
  await expect(page).toHaveURL(/control$/);
  expect(
    await page.evaluate(() => ({
      old: !!(window as any).__oldDocument,
      provider: !!(window as any).puter,
    })),
  ).toEqual({ old: false, provider: false });
});
test("a saved local profile is not presented as a verified Google account", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("onebrain");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result,
          tx = database.transaction("kv", "readwrite");
        tx.objectStore("kv").put({
          key: "user",
          value: {
            id: "cached-not-authenticated",
            email: "cached-only@example.test",
          },
        });
        tx.oncomplete = () => {
          database.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.goto("/settings/account");
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("cached-only@example.test")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
});
test("all-session sign-out requires confirmation and revokes the current fixture session", async ({
  page,
}) => {
  await seedServerSession(page);
  await page.goto("/settings/account");
  await expect(
    page.getByText("GOOGLE ACCOUNT · SESSION VERIFIED"),
  ).toBeVisible();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Sign out all sessions", exact: true })
    .click();
  await expect(
    page.getByText("GOOGLE ACCOUNT · SESSION VERIFIED"),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Sign out all sessions", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "All OneBrain server sessions have been revoked" }),
  ).toBeVisible();
  expect((await page.request.get("/api/platform/me")).status()).toBe(401);
});
test("privacy preferences persist and local deletion has a cancellable confirmation", async ({
  page,
}) => {
  await page.goto("/settings/privacy");
  await page.getByRole("checkbox", { name: /^Save memory/ }).uncheck();
  await page
    .getByRole("combobox", { name: "Forget chats older than", exact: true })
    .selectOption("30");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: /^Save memory/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("combobox", {
      name: "Forget chats older than",
      exact: true,
    }),
  ).toHaveValue("30");
  await page
    .getByRole("link", { name: "Export & delete local data ↗", exact: true })
    .click();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete local canvas data", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete local canvas data", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Local canvas database cleared",
  );
  await page.goto("/settings/privacy");
  await expect(
    page.getByRole("combobox", {
      name: "Forget chats older than",
      exact: true,
    }),
  ).toHaveValue("0");
});

for (const action of ["cancel", "close"] as const)
  test(`voice enrollment releases a late microphone stream after ${action}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__stopped = false;
      navigator.mediaDevices.getUserMedia = () =>
        new Promise((resolve) => {
          w.__deliverMic = () =>
            resolve({
              getTracks: () => [
                {
                  stop() {
                    w.__stopped = true;
                  },
                },
              ],
            } as unknown as MediaStream);
        });
    });
    await page.goto("/settings/advanced");
    await page
      .getByText("Manage voice baseline & filter", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enroll my voice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel enrollment", exact: true }),
    ).toBeVisible();
    if (action === "cancel")
      await page
        .getByRole("button", { name: "Cancel enrollment", exact: true })
        .click();
    else
      await page
        .getByText("Manage voice baseline & filter", { exact: true })
        .click();
    await page.evaluate(() => (window as any).__deliverMic());
    await expect
      .poll(() => page.evaluate(() => (window as any).__stopped))
      .toBe(true);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("onebrain-settings") || "{}")
            .voiceBaseline,
      ),
    ).toBeNull();
  });
