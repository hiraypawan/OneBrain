import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Tests exercise deterministic functionality without sending any content to AI providers.
  await page.route("https://js.puter.com/**", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("tab", {name:"Context map",exact:true}).click();
});
test("capture, persistence, explicit links, task completion and verified undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await expect(
    page.getByRole("heading", { name: /Notes. Tasks. Answers./ }),
  ).toBeVisible();
  await page.getByLabel("Capture type").selectOption("person");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("Rahul — ABC Corp");
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Save 1 item", exact: true }).click();
  await expect(page.locator(".thought-node")).toHaveCount(1);
  await page.getByLabel("Capture type").selectOption("task");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("Prepare the website quotation");
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
  await page.getByRole("button", { name: "Save 1 item", exact: true }).click();
  await expect(page.locator(".thought-node")).toHaveCount(2);
  await page
    .locator(".thought-node")
    .filter({ hasText: "Prepare the website quotation" })
    .click();
  await page.getByLabel("Rahul — ABC Corp", { exact: true }).check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".connections-svg line")).toHaveCount(1);
  await page.reload();
  await page.getByRole("tab", {name:"Context map",exact:true}).click();
  await expect(page.locator(".thought-node")).toHaveCount(2);
  await expect(page.locator(".connections-svg line")).toHaveCount(1);
  await page.getByRole("tab", { name: /Today/ }).click();
  await page
    .getByRole("button", { name: "Complete Prepare the website quotation" })
    .click();
  await expect(page.locator(".task-row")).toHaveCount(0);
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.locator(".receipt")).toHaveCount(4);
  await expect(page.locator(".receipt").first()).toContainText(
    "Verified locally",
  );
  await page
    .locator(".receipt")
    .first()
    .getByRole("button", { name: "Undo" })
    .click();
  await page.getByRole("tab", { name: /Today/ }).click();
  await expect(page.locator(".task-row")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("proactive settings opt in and persist; dialog is keyboard accessible", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  const toggle = page.getByRole("checkbox", {
    name: /^Proactive conversation/,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("checkbox", { name: /^Revisit earlier/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open to conversation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("checkbox", { name: /^Proactive conversation/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: /^Revisit earlier/ }),
  ).toBeChecked();
});
test("mobile layout, brain dump preview and memory-off behavior", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("checkbox", { name: /^Save memory on this device/ })
    .uncheck();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Capture type").selectOption("dump");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("task: Call the vendor\nidea: Referral offer\nshopping: Milk");
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
  await expect(page.locator(".draft-editor")).toHaveCount(3);
  await page.getByRole("button", { name: "Save 3 items" }).click();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.locator(".receipt")).toContainText("Session only");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".thought-node")).toHaveCount(0);
});
test("typed calculation is deterministic and connector status is honest", async ({
  page,
}) => {
  await page.getByLabel("Capture type").selectOption("ask");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("15% of 60000");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  await expect(page.getByRole("region",{name:"OneBrain response"})).toContainText("9000");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("button", { name: "Open connections" }).click();
  await expect(page.getByRole("dialog")).toContainText("not uploaded automatically");
  await expect(page.getByRole("dialog")).toContainText("review scheduled actions");
});

test("proactive voice invitation waits for silence, gets consent and stops with the session", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 8, 10, 12, 0) });
  await page.evaluate(() => {
    const track = {
      readyState: "live",
      muted: false,
      stop() {
        this.readyState = "ended";
      },
      onended: null,
      onmute: null,
      onunmute: null,
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getAudioTracks: () => [track],
          getTracks: () => [track],
        }),
        addEventListener() {},
        removeEventListener() {},
        enumerateDevices: async () => [],
      },
    });
    class Recognition {
      start() {
        this.onstart?.();
      }
      stop() {}
      onstart: any;
      onresult: any;
      onspeechstart: any;
      onspeechend: any;
      constructor() {
        (window as any).__testRecognition = this;
      }
    }
    (window as any).SpeechRecognition = Recognition;
    (window as any).Notification = undefined;
    const spoken: string[] = [];
    (window as any).__testSpoken = spoken;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [],
        speak(utterance: any) {
          spoken.push(utterance.text);
          setTimeout(() => utterance.onend?.(), 10);
        },
      },
    });
  });
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("checkbox", { name: /^Proactive conversation/ }).check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByTestId("active-button").click();
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.clock.runFor(60000);
  await expect(page.locator(".proactive-card")).toHaveCount(0);
  // Actual speech onset resets the idle clock, even without a final transcript.
  await page.evaluate(() => (window as any).__testRecognition.onspeechstart());
  await page.clock.runFor(60000);
  await expect(page.locator(".proactive-card")).toHaveCount(0);
  await page.clock.runFor(40000);
  await expect(page.locator(".proactive-card")).toContainText(
    "May I ask one question",
  );
  let spoken = await page.evaluate(
    () => (window as any).__testSpoken as string[],
  );
  expect(spoken.some((t) => t.includes("quick next step"))).toBe(false);
  await page.getByRole("button", { name: "Go ahead", exact: true }).click();
  await page.clock.runFor(100);
  spoken = await page.evaluate(() => (window as any).__testSpoken as string[]);
  expect(spoken.some((t) => t.includes("quick next step"))).toBe(true);
  await expect(page.locator(".proactive-card")).toHaveCount(0);
  await page.getByTestId("stop-button").click();
  await page.clock.runFor(3600000);
  await expect(page.locator(".proactive-card")).toHaveCount(0);
});
