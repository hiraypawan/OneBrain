import { test, expect, type Page } from "@playwright/test";
import { deviceChanged, endLiveMicTrack, micState, mockVoice, say } from "./voice-stub";

// The microphone SESSION, as opposed to one turn: what happens when the audio
// device changes under a live session, when the engine never comes up, when the
// browser has no model for the chosen language, and when the person presses
// Stop.
//
// These are the paths that were untestable before, because the stub's
// `addEventListener() {}` swallowed every devicechange. A session could go deaf
// — microphone hot, "listening" on screen, nothing heard — with the whole suite
// green, which is exactly what the reported bug was: the first tap on "Start
// talking" appeared to do nothing, and only Stop + Start again recovered it.
// See docs/AUDIT-2026-09-27-VOICE-AND-INTENT.md (findings V1–V3).

test.beforeEach(async ({ page }) => {
  await page.route("https://js.puter.com/**", (route) => route.abort());
  await page.goto("/");
});

const answer = (page: Page) => page.getByRole("region", { name: "OneBrain response" });
/** The one status line Today uses for microphone trouble (NoticeStrip). */
const notice = (page: Page) => page.locator("body");

async function startListening(page: Page) {
  await page.getByTestId("active-button").click();
  await expect(page.getByTestId("stop-button")).toBeVisible();
  await expect(page.locator(".session-state")).toContainText("listening");
  // The engine confirmed it is up and the mic is the only one running.
  await expect.poll(async () => (await micState(page)).running).toBe(1);
}

test("the first tap still listens after the browser reports a device change", async ({
  page,
}) => {
  await mockVoice(page);
  await startListening(page);

  // Granting microphone permission makes device labels visible, and Chrome
  // announces that as a devicechange — so this fires right after the very first
  // Start talking tap on a real phone. It must not cost the session its ears.
  const before = await micState(page);
  await deviceChanged(page);
  await expect
    .poll(async () => (await micState(page)).recognitions, { timeout: 5000 })
    .toBeGreaterThan(before.recognitions);

  // One recognizer alive, one microphone open, the old one stopped.
  const after = await micState(page);
  expect(after.running).toBe(1);
  expect(after.liveTracks).toBe(1);
  expect(after.stops).toBeGreaterThan(before.stops);

  // And the very first line the person says is still heard.
  await say(page, "20 + 4", 0.9);
  await expect(answer(page)).toContainText("24", { timeout: 5000 });
  await page.getByTestId("stop-button").click();
});

test("a device change mid-conversation does not swallow the next line", async ({ page }) => {
  await mockVoice(page);
  await startListening(page);
  await say(page, "12 * 3", 0.9);
  await expect(answer(page)).toContainText("36", { timeout: 5000 });
  await expect.poll(async () => (await micState(page)).running).toBe(1);

  await deviceChanged(page);
  await expect(page.locator(".session-state")).toContainText("listening");
  await expect.poll(async () => (await micState(page)).running).toBe(1);

  await say(page, "36 + 6", 0.9);
  await expect(answer(page)).toContainText("42", { timeout: 5000 });
  await page.getByTestId("stop-button").click();
});

test("Stop releases the microphone even after a device change", async ({ page }) => {
  await mockVoice(page);
  await startListening(page);
  await deviceChanged(page);
  await expect.poll(async () => (await micState(page)).recognitions).toBeGreaterThan(1);

  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("active-button")).toBeEnabled();
  await expect(page.locator(".session-state")).not.toContainText("listening");

  // No orphaned recognizer, no live microphone track: the mic indicator must
  // not say "off" while the browser is still capturing.
  await expect.poll(async () => (await micState(page)).running, { timeout: 5000 }).toBe(0);
  await expect.poll(async () => (await micState(page)).liveTracks, { timeout: 5000 }).toBe(0);
});

test("an earbud microphone that disappears is picked up again on the new mic", async ({
  page,
}) => {
  await mockVoice(page);
  await startListening(page);
  const before = await micState(page);

  // Multipoint earbuds jumping to a laptop call end the track underneath us.
  await endLiveMicTrack(page);
  await expect
    .poll(async () => (await micState(page)).recognitions, { timeout: 8000 })
    .toBeGreaterThan(before.recognitions);
  await expect.poll(async () => (await micState(page)).running).toBe(1);
  await expect.poll(async () => (await micState(page)).liveTracks).toBe(1);

  await say(page, "50 + 5", 0.9);
  await expect(answer(page)).toContainText("55", { timeout: 5000 });
  await page.getByTestId("stop-button").click();
});

test("repeated device changes never stack recognizers or microphones", async ({ page }) => {
  await mockVoice(page);
  await startListening(page);
  await deviceChanged(page);
  await deviceChanged(page);
  await deviceChanged(page);
  await expect.poll(async () => (await micState(page)).recognitions).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await micState(page)).running, { timeout: 5000 }).toBe(1);
  await expect.poll(async () => (await micState(page)).liveTracks, { timeout: 5000 }).toBeLessThanOrEqual(1);

  await say(page, "9 + 1", 0.9);
  await expect(answer(page)).toContainText("10", { timeout: 5000 });
  await page.getByTestId("stop-button").click();
});

test("an engine that accepts start() and never comes up is rebuilt once, then reported", async ({
  page,
}) => {
  test.slow(); // two watchdog windows (8 s each) before the honest notice
  await mockVoice(page, { deafEngine: true });
  await startListening(page);

  // First watchdog: try a fresh recognizer before blaming anything.
  await expect
    .poll(async () => (await micState(page)).recognitions, { timeout: 20000 })
    .toBeGreaterThan(1);

  // Second watchdog: stop pretending. "Listening" with nothing heard is the one
  // state the UI must never claim silently.
  await expect(notice(page)).toContainText(/nothing is being heard/i, { timeout: 20000 });
  await page.getByTestId("stop-button").click();
  await expect.poll(async () => (await micState(page)).running, { timeout: 5000 }).toBe(0);
});

test("a language the engine has no model for falls back and says so", async ({ page }) => {
  await mockVoice(page);
  await startListening(page);

  await page.evaluate(() =>
    (window as any).__testRecognition.emitError("language-not-supported"),
  );

  // Told plainly, and still listening — in a language the engine does have.
  await expect(notice(page)).toContainText(/no speech model for that language/i, {
    timeout: 5000,
  });
  await expect
    .poll(async () => (await micState(page)).langs.slice(-1)[0], { timeout: 5000 })
    .toBe("en-IN");
  await expect.poll(async () => (await micState(page)).running).toBe(1);

  await say(page, "60 + 6", 0.9);
  await expect(answer(page)).toContainText("66", { timeout: 5000 });
  await page.getByTestId("stop-button").click();
});

test("a Stop while speaking ends the session instead of leaving the mic to the reply", async ({
  page,
}) => {
  await mockVoice(page);
  await startListening(page);
  await say(page, "100 + 1", 0.9);
  await expect(answer(page)).toContainText("101", { timeout: 5000 });
  // Press Stop while the reply may still be spoken.
  await page.getByTestId("stop-button").click();
  await expect(page.getByTestId("active-button")).toBeEnabled();
  await expect.poll(async () => (await micState(page)).running, { timeout: 5000 }).toBe(0);
  await expect.poll(async () => (await micState(page)).liveTracks, { timeout: 5000 }).toBe(0);
  await expect(page.locator(".session-state")).not.toContainText("listening");
});
