import { test, expect, type Page } from "@playwright/test";

// End-to-end voice turn: speech result -> answer -> spoken reply -> mic back.
// The recognizer mock behaves like real engines do, which is what the old
// mocks never covered:
//  * Android Chrome flags results `isFinal` with `confidence: 0`;
//  * `stop()` fires `onend` asynchronously and a start() racing it throws
//    InvalidStateError ("already started") — exactly like Chrome;
//  * speechSynthesis fires onstart/onend.
test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (route) => route.abort());
  await page.goto("/");
});

async function mockVoice(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
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
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => ({ release: async () => {} }) },
    });
    w.__starts = 0;
    w.__stops = 0;
    class Recognition {
      running = false;
      onstart: any;
      onend: any;
      onerror: any;
      onresult: any;
      onspeechstart: any;
      onspeechend: any;
      constructor() {
        w.__testRecognition = this;
      }
      start() {
        if (this.running)
          throw new DOMException("recognition has already started", "InvalidStateError");
        this.running = true;
        w.__starts++;
        setTimeout(() => this.onstart?.(), 0);
      }
      stop() {
        if (!this.running) return;
        w.__stops++;
        this.running = false;
        setTimeout(() => this.onend?.(), 20);
      }
      abort() {
        this.stop();
      }
      // Emit one SpeechRecognitionEvent-shaped batch.
      emit(entries: Array<{ text: string; isFinal: boolean; confidence: number }>, resultIndex = 0) {
        const results: any = entries.map((e) => {
          const r: any = [{ transcript: e.text, confidence: e.confidence }];
          r.isFinal = e.isFinal;
          return r;
        });
        this.onresult?.({ resultIndex, results });
      }
    }
    w.SpeechRecognition = Recognition;
    w.webkitSpeechRecognition = undefined;
    w.Notification = undefined;
    w.__spoken = [];
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speaking: false,
        paused: false,
        cancel() {},
        resume() {},
        getVoices: () => [],
        speak(u: any) {
          w.__spoken.push(u.text);
          setTimeout(() => u.onstart?.(), 5);
          setTimeout(() => u.onend?.(), 40);
        },
      },
    });
  });
}

test("Android-style confidence-0 finals produce an answer, speech and a resumed mic", async ({
  page,
}) => {
  await mockVoice(page);
  await page.getByTestId("active-button").click();
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await expect(page.locator(".session-state")).toContainText("listening");
  // Android: interim-ish words all arrive as isFinal with confidence 0.
  await page.evaluate(() => {
    const r = (window as any).__testRecognition;
    r.emit([{ text: "20", isFinal: true, confidence: 0 }]);
    r.emit([{ text: "20 +", isFinal: true, confidence: 0 }]);
    r.emit([{ text: "20 + 4", isFinal: true, confidence: 0 }]);
  });
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText("24", {
    timeout: 5000,
  });
  const spoken = await page.evaluate(() => (window as any).__spoken as string[]);
  expect(spoken.some((t) => t.includes("24"))).toBe(true);
  // Mic resumed after the reply: the recognizer was restarted.
  await expect(page.locator(".session-state")).toContainText("listening");
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        running: (window as any).__testRecognition.running,
        starts: (window as any).__starts,
      })),
    )
    .toEqual({ running: true, starts: 2 });
  // Second turn works too (no "Finish or cancel the current request" lockout).
  await page.evaluate(() =>
    (window as any).__testRecognition.emit([{ text: "20 + 5", isFinal: true, confidence: 0.91 }]),
  );
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText("25");
  await expect(page.locator(".workspace-notice")).not.toContainText("Finish or cancel");
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("active-button")).toBeEnabled();
});

test("a repeated final inside the dedupe window is answered once; scored noise is ignored", async ({
  page,
}) => {
  await mockVoice(page);
  await page.getByTestId("active-button").click();
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.evaluate(() => {
    const r = (window as any).__testRecognition;
    r.emit([{ text: "tv bleed", isFinal: true, confidence: 0.05 }]);
    r.emit([{ text: "12 * 3", isFinal: true, confidence: 0.8 }]);
    // Chrome re-fires the same final now and then: must not become a 2nd turn.
    r.emit([{ text: "12 * 3", isFinal: true, confidence: 0.8 }]);
  });
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText("36");
  await expect.poll(() => page.evaluate(() => (window as any).__testRecognition.running)).toBe(true);
  const spoken = await page.evaluate(() => (window as any).__spoken as string[]);
  expect(spoken.filter((t) => t.includes("36")).length).toBe(1);
  expect(spoken.some((t) => /bleed/i.test(t))).toBe(false);
  await page.getByTestId("stop-button").click();
});

test("recognizer ending right after an unscored final still answers (Android session end)", async ({
  page,
}) => {
  await mockVoice(page);
  await page.getByTestId("active-button").click();
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await page.evaluate(() => {
    const r = (window as any).__testRecognition;
    r.emit([{ text: "7 + 8", isFinal: true, confidence: 0 }]);
    // Android ends the continuous session immediately after the utterance.
    r.running = false;
    r.onend?.();
  });
  await expect(page.getByRole("region", { name: "OneBrain response" })).toContainText("15");
  await expect.poll(() => page.evaluate(() => (window as any).__testRecognition.running)).toBe(true);
  await page.getByTestId("stop-button").click();
});
