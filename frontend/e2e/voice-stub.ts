import type { Page } from "@playwright/test";
import { stubSpeechService } from "./audio-stub";

/**
 * The microphone + speech-recognition double every voice spec drives.
 *
 * It behaves like real engines do, which is what a hand-rolled stub per spec
 * kept getting wrong:
 *  * Android Chrome flags results `isFinal` with `confidence: 0`;
 *  * `stop()` fires `onend` asynchronously, and a `start()` racing it throws
 *    InvalidStateError ("already started") — exactly like Chrome;
 *  * `navigator.mediaDevices` is a real EventTarget, so a `devicechange`
 *    (Bluetooth earbuds in/out, a multipoint handover) actually reaches the
 *    app. The old stub's `addEventListener() {}` made that path untestable,
 *    which is how a session could go deaf with the whole suite green;
 *  * speechSynthesis fires onstart/onend.
 *
 * Everything the specs assert on is counted on `window`: every recognizer ever
 * built (`__recognitions`), every mic track ever handed out (`__micTracks`),
 * and `__starts` / `__stops`. A session that rebuilds the recognizer after a
 * device change, or that leaves one running after Stop, shows up there.
 */
export interface VoiceStubOptions {
  /**
   * Simulate an engine that accepts `start()` and then never comes up: no
   * onstart, no onend, no error. Chrome does this when its speech service is
   * unreachable, and the UI used to sit on "listening" forever.
   */
  deafEngine?: boolean;
}

export async function mockVoice(page: Page, options: VoiceStubOptions = {}) {
  await stubSpeechService(page);
  await page.evaluate((deafEngine) => {
    const w = window as any;
    w.__starts = 0;
    w.__stops = 0;
    w.__recognitions = [];
    w.__micTracks = [];
    w.__spoken = [];
    w.__deafEngine = !!deafEngine;

    class Recognition {
      running = false;
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: any;
      onend: any;
      onerror: any;
      onresult: any;
      onspeechstart: any;
      onspeechend: any;
      constructor() {
        w.__recognitions.push(this);
        // Specs talk to the newest one; the list above keeps the old ones so a
        // test can prove they were stopped instead of orphaned.
        w.__testRecognition = this;
      }
      start() {
        if (this.running)
          throw new DOMException("recognition has already started", "InvalidStateError");
        this.running = true;
        w.__starts++;
        if (!w.__deafEngine) setTimeout(() => this.onstart?.(), 0);
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
      /** Emit one SpeechRecognitionEvent-shaped batch. */
      emit(entries: Array<{ text: string; isFinal: boolean; confidence: number }>, resultIndex = 0) {
        const results: any = entries.map((e) => {
          const r: any = [{ transcript: e.text, confidence: e.confidence }];
          r.isFinal = e.isFinal;
          return r;
        });
        this.onresult?.({ resultIndex, results });
      }
      /** Emit a SpeechRecognitionErrorEvent-shaped failure. */
      emitError(code: string) {
        this.onerror?.({ error: code });
      }
    }
    w.SpeechRecognition = Recognition;
    w.webkitSpeechRecognition = undefined;
    w.Notification = undefined;

    // A real EventTarget: the app's devicechange listener has to be reachable.
    const devices: any = new EventTarget();
    devices.getUserMedia = async () => {
      const track: any = {
        id: `track-${w.__micTracks.length}`,
        readyState: "live",
        muted: false,
        label: `Stub microphone ${w.__micTracks.length}`,
        kind: "audio",
        stop() {
          this.readyState = "ended";
        },
        onended: null,
        onmute: null,
        onunmute: null,
      };
      w.__micTracks.push(track);
      return { getAudioTracks: () => [track], getTracks: () => [track] };
    };
    devices.enumerateDevices = async () => [];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: devices,
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: async () => ({ release: async () => {} }) },
    });

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
  }, options.deafEngine ?? false);
}

/** The OS reports an audio device change (earbuds connected, multipoint jump). */
export async function deviceChanged(page: Page) {
  await page.evaluate(() =>
    navigator.mediaDevices.dispatchEvent(new Event("devicechange")),
  );
}

/** An earbud microphone disappears: the live track ends on its own. */
export async function endLiveMicTrack(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const track = [...w.__micTracks].reverse().find((t: any) => t.readyState === "live");
    if (!track) throw new Error("no live mic track to end");
    track.readyState = "ended";
    track.onended?.();
  });
}

/** Say one line to the recognizer the app is currently listening through. */
export async function say(page: Page, text: string, confidence = 0.9) {
  await page.evaluate(
    ({ text, confidence }) => {
      const r = (window as any).__testRecognition;
      if (!r) throw new Error("no recognizer was ever built");
      r.emit([{ text, isFinal: true, confidence }]);
    },
    { text, confidence },
  );
}

export const micState = (page: Page) =>
  page.evaluate(() => {
    const w = window as any;
    return {
      recognitions: w.__recognitions.length as number,
      running: (w.__recognitions as any[]).filter((r) => r.running).length,
      starts: w.__starts as number,
      stops: w.__stops as number,
      liveTracks: (w.__micTracks as any[]).filter((t) => t.readyState === "live").length,
      langs: (w.__recognitions as any[]).map((r) => r.lang),
      spoken: w.__spoken as string[],
    };
  });
