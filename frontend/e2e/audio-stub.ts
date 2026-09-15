import type { Page } from "@playwright/test";

/**
 * Replies try real audio before the browser voice. Tests that assert spoken
 * output stub the audio service out, so the fallback path is deterministic and
 * no test depends on an outbound provider.
 */
export async function stubSpeechService(page: Page) {
  await page.route("**/api/speech/tts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ fallback: true }),
    }),
  );
}
