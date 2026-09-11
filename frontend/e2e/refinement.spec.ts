import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (route) => route.abort());
  await page.goto("/");
});
async function dump(page: Page, text: string) {
  await page.getByLabel("Capture type", { exact: true }).selectOption("dump");
  await page.getByLabel("Capture a thought", { exact: true }).fill(text);
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
}
for (const width of [320, 390, 768, 1440]) {
  test(`map fits ${width}px, genuinely zooms, and bounds rendering with pagination`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await dump(
      page,
      Array.from(
        { length: 19 },
        (_, i) => `note: Context ${i + 1} for the client proposal`,
      ).join("\n"),
    );
    await page
      .getByRole("button", { name: "Save 19 items", exact: true })
      .click();
    await expect(page.locator(".thought-node")).toHaveCount(18);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".canvas-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    const box = await page.locator(".thought-node").first().boundingBox();
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const zoomed = await page.locator(".thought-node").first().boundingBox();
    expect(zoomed!.width / box!.width).toBeCloseTo(1.2, 1);
    await page.getByRole("button", { name: "Reset map zoom" }).click();
    expect(
      await page
        .locator(".canvas-scroll")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await page.getByRole("button", { name: "Next map page" }).click();
    await expect(page.locator(".thought-node")).toHaveCount(1);
    await page.getByRole("button", { name: "Previous map page" }).click();
    await expect(page.locator(".thought-node")).toHaveCount(18);
    await page.getByLabel("Search your memory").fill("NoSuchMemory");
    await expect(
      page.getByRole("heading", { name: "No matching thoughts." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear search & filters" }).click();
    await expect(page.locator(".thought-node")).toHaveCount(18);
    expect(errors).toEqual([]);
  });
}
test("oversized brain dumps show a recoverable error without discarding input", async ({
  page,
}) => {
  const source = Array.from(
    { length: 31 },
    (_, i) => `note: Thought ${i}`,
  ).join("\n");
  await dump(page, source);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("more than 30");
  await expect(
    page.getByLabel("Capture a thought", { exact: true }),
  ).toHaveValue(source);
  await expect(page.locator(".thought-node")).toHaveCount(0);
});
test("financial review edits are persisted; the named dialog stays mounted and restores focus", async ({
  page,
}) => {
  await page
    .getByLabel("Capture type", { exact: true })
    .selectOption("expense");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("expense: $12.345 lunch");
  await page
    .getByRole("button", { name: "Review capture", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Review your capture" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Amount (review before saving)")).toHaveValue(
    "",
  );
  await dialog.getByLabel("Amount (review before saving)").fill("12.34");
  await dialog
    .getByRole("combobox", { name: "Currency", exact: true })
    .selectOption("USD");
  await dialog
    .getByRole("button", { name: "Save 1 item", exact: true })
    .click();
  await page.locator(".thought-node").click();
  const detail = page.getByRole("dialog", { name: "The full context" });
  await expect(detail.getByLabel("Amount", { exact: true })).toHaveValue(
    "12.34",
  );
  await detail.evaluate((el) => {
    (window as any).__originalDialog = el;
  });
  await detail.getByLabel("Title", { exact: true }).fill("Lunch receipt");
  await detail
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(detail.getByRole("status")).toContainText("verified");
  expect(
    await detail.evaluate((el) => el === (window as any).__originalDialog),
  ).toBe(true);
  const bounds = await detail.boundingBox();
  await page.mouse.click(bounds!.x + 3, bounds!.y + 3);
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".thought-node")).toBeFocused();
  await page.reload();
  await page.locator(".thought-node").click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("12.34");
});
test("workspace tabs have arrow-key, Home and End navigation", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Context map" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "List", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "List", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Activity", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Search your memory")).toHaveCount(0);
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "Context map" })).toBeFocused();
});

async function mockAudio(
  page: Page,
  options: { deferred?: boolean; unsupported?: boolean; throws?: boolean } = {},
) {
  await page.evaluate((options) => {
    const w = window as any;
    w.__streams = [];
    w.__micCalls = 0;
    w.__pendingMic = [];
    w.__recognitionStarts = 0;
    w.__makeStream = () => {
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
      w.__streams.push(track);
      return { getAudioTracks: () => [track], getTracks: () => [track] };
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          w.__micCalls++;
          return options.deferred
            ? new Promise((resolve) => w.__pendingMic.push(resolve))
            : Promise.resolve(w.__makeStream());
        },
        addEventListener() {},
        removeEventListener() {},
        enumerateDevices: async () => [],
      },
    });
    w.__resolveMic = () => w.__pendingMic.shift()(w.__makeStream());
    class Recognition {
      onstart: any;
      onresult: any;
      onend: any;
      start() {
        if (options.throws) throw new Error("Recognition failed to start");
        w.__recognitionStarts++;
        this.onstart?.();
      }
      stop() {}
    }
    w.SpeechRecognition = options.unsupported ? undefined : Recognition;
    w.webkitSpeechRecognition = undefined;
    w.Notification = undefined;
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => ({ release: async () => {} }) },
    });
  }, options);
}
test("cancelled permission responses release late microphone streams without starting recognition", async ({
  page,
}) => {
  await mockAudio(page, { deferred: true });
  await page.getByTestId("active-button").click();
  await page.getByRole("button", { name: "Cancel microphone start" }).click();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(page.getByTestId("active-button")).toBeEnabled();
  expect(
    await page.evaluate(() => ({
      starts: (window as any).__recognitionStarts,
      tracks: (window as any).__streams.map((t: any) => t.readyState),
    })),
  ).toEqual({ starts: 0, tracks: ["ended"] });
  await page.getByTestId("active-button").click();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.getByTestId("stop-button").click();
  expect(
    await page.evaluate(() =>
      (window as any).__streams.every((t: any) => t.readyState === "ended"),
    ),
  ).toBe(true);
});
test("navigating away while permission is pending cannot leave the mic running", async ({
  page,
}) => {
  await mockAudio(page, { deferred: true });
  await page.getByTestId("active-button").click();
  // Settings now intentionally use a fresh document to exclude an already loaded AI SDK.
  // Reminders remains a client-side transition, so this still exercises hook cleanup.
  await page.getByRole("link", { name: "Reminders", exact: true }).click();
  await expect(page).toHaveURL(/reminders/);
  await page.evaluate(() => (window as any).__resolveMic());
  expect(
    await page.evaluate(() =>
      (window as any).__streams.every((t: any) => t.readyState === "ended"),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).__recognitionStarts)).toBe(
    0,
  );
});
test("unsupported speech never requests a mic; recognition startup failures release it", async ({
  page,
}) => {
  await mockAudio(page, { unsupported: true });
  await page.getByTestId("active-button").click();
  await expect(page.getByRole("status")).toContainText(
    "unavailable in this browser",
  );
  expect(await page.evaluate(() => (window as any).__micCalls)).toBe(0);
  await mockAudio(page, { throws: true });
  await page.getByTestId("active-button").click();
  await expect(page.getByRole("status")).toContainText("Recognition failed");
  expect(
    await page.evaluate(() =>
      (window as any).__streams.every((t: any) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await expect(page.getByTestId("active-button")).toBeEnabled();
});
test("resume events keep a live mic and cannot resurrect a stopped session", async ({
  page,
}) => {
  await mockAudio(page, { deferred: true });
  await page.getByTestId("active-button").click();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => (window as any).__micCalls)).toBe(1);
  await page.evaluate(() => {
    (window as any).__streams[0].readyState = "ended";
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(await page.evaluate(() => (window as any).__micCalls)).toBe(2);
  await page.getByTestId("stop-button").click();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(page.getByTestId("active-button")).toBeEnabled();
  await expect(page.locator(".session-state")).toContainText(
    "Ready when you are",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__streams.every((t: any) => t.readyState === "ended"),
    ),
  ).toBe(true);
});

test("a cancelled start finishing cannot clear the newer permission request UI", async ({
  page,
}) => {
  await mockAudio(page, { deferred: true });
  await page.getByTestId("active-button").click();
  await page.getByRole("button", { name: "Cancel microphone start" }).click();
  await page.getByTestId("active-button").click();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(
    page.getByRole("button", { name: "Cancel microphone start" }),
  ).toBeVisible();
  await expect(page.getByTestId("active-button")).toBeDisabled();
  await page.evaluate(() => (window as any).__resolveMic());
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.getByTestId("stop-button").click();
});

test("stopping speech releases the turn and its old timeout cannot cancel a new reply", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 8, 10, 12) });
  await mockAudio(page);
  await page.evaluate(() => {
    const w = window as any;
    w.__cancelCount = 0;
    w.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {
          w.__cancelCount++;
        },
        getVoices: () => [],
        speak(u: any) {
          w.__spoken.push(u.text);
        },
      },
    });
  });
  await page.getByTestId("active-button").click();
  await page.getByLabel("Capture type", { exact: true }).selectOption("ask");
  await page.getByLabel("Capture a thought", { exact: true }).fill("20 + 4");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  await expect(page.locator(".session-state")).toContainText("speaking");
  await page.clock.runFor(30000);
  await page.getByTestId("stop-button").click();
  await page.getByTestId("active-button").click();
  await page.getByLabel("Capture a thought", { exact: true }).fill("20 + 5");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  await expect(page.locator(".last-response")).toContainText("25");
  await expect(page.locator(".session-state")).toContainText("speaking");
  const cancellations = await page.evaluate(
    () => (window as any).__cancelCount,
  );
  await page.clock.runFor(31000);
  expect(await page.evaluate(() => (window as any).__cancelCount)).toBe(
    cancellations,
  );
  await expect(page.locator(".session-state")).toContainText("speaking");
  await page.getByTestId("stop-button").click();
});

test("revoking topic permission invalidates an invitation that was already offered", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 8, 10, 12) });
  await mockAudio(page);
  await page.evaluate(() => {
    (window as any).__spoken = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [],
        speak(u: any) {
          (window as any).__spoken.push(u.text);
          setTimeout(() => u.onend?.(), 1);
        },
      },
    });
  });
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("checkbox", { name: /^Proactive conversation/ }).check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByTestId("active-button").click();
  await page.clock.runFor(100000);
  await expect(page.locator(".proactive-card")).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("checkbox", { name: /^Ask occasional preference/ })
    .uncheck();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Go ahead", exact: true }).click();
  await page.clock.runFor(20);
  await expect(page.locator(".last-response")).toContainText(
    "no longer available",
  );
  expect(
    await page.evaluate(() =>
      (window as any).__spoken.some((t: string) =>
        t.includes("quick next step"),
      ),
    ),
  ).toBe(false);
  await page.getByTestId("stop-button").click();
});

test("voice-style reminder commands do not write to disk with Memory off", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page
    .getByRole("checkbox", { name: /^Save memory on this device/ })
    .uncheck();
  await page.getByRole("checkbox", { name: /^Silent Mode/ }).check();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Capture type", { exact: true }).selectOption("ask");
  await page
    .getByLabel("Capture a thought", { exact: true })
    .fill("remind me to call mom at 6pm");
  await page.getByRole("button", { name: "Ask OneBrain", exact: true }).click();
  await expect(page.locator(".last-response")).toContainText(
    "no reminder was saved or scheduled",
  );
  const count = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("onebrain");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("reminders")
            .objectStore("reminders")
            .count();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );
  expect(count).toBe(0);
});
test('pause releases the microphone and resume explicitly acquires a new stream',async({page})=>{
 await mockAudio(page);await page.getByTestId('active-button').click();await expect(page.getByTestId('stop-button')).toBeVisible();
 await page.getByRole('button',{name:'Pause session',exact:true}).click();await expect(page.getByTestId('active-button')).toContainText('Resume Pocket Mode');
 expect(await page.evaluate(()=>(window as any).__streams.every((t:any)=>t.readyState==='ended'))).toBe(true);
 await page.getByTestId('active-button').click();await expect(page.getByTestId('stop-button')).toBeVisible();expect(await page.evaluate(()=>(window as any).__micCalls)).toBe(2);
 await page.getByTestId('stop-button').click();expect(await page.evaluate(()=>(window as any).__streams.every((t:any)=>t.readyState==='ended'))).toBe(true);
});
