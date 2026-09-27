import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Microphone-session wiring regressions (audit findings V1–V6).
 *
 * The reported bug: the first tap on "Start talking" appeared to do nothing —
 * no speech was captured, and the person had to press Stop and Start again.
 * The cause was not the button. It was the session: `acquireMic` dropped
 * `recogRef` without stopping or rebuilding the recognizer, every recognizer
 * callback then failed its `recogRef.current !== recog` identity guard, and the
 * UI kept saying "listening" while hearing nothing. Granting microphone
 * permission fires a `devicechange` in Chrome, so it happened on the very first
 * tap of a fresh session; Bluetooth in/out, a multipoint handover and an
 * earbud track ending did it later.
 *
 * The browser suite (e2e/voice-session.spec.ts) covers the behaviour, but it
 * needs three engines and a built frontend, so these assertions check the
 * connections themselves — the same trade `media-wiring.test.ts` makes for the
 * music player. A unit test of a pure helper cannot catch any of this.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const hook = read('hooks/useAssistant.ts');

/**
 * The body of one function/callback, brace-matched from its header. A function
 * that is missing yields an empty string rather than throwing, so every
 * assertion below fails on its own terms and says what it wanted.
 */
function bodyOf(header: RegExp, label: string): string {
  const m = header.exec(hook);
  if (!m) return '';
  void label;
  const open = hook.indexOf('{', m.index + m[0].length);
  let depth = 0;
  for (let i = open; i < hook.length; i++) {
    if (hook[i] === '{') depth++;
    else if (hook[i] === '}') {
      depth--;
      if (depth === 0) return hook.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces while reading ${label}`);
}

const teardown = bodyOf(/const teardownRecognition = useCallback\(\(\) =>/, 'teardownRecognition');
const startRecognition = bodyOf(
  /const startRecognition = useCallback\(\(\): boolean =>/,
  'startRecognition',
);
const resumeListening = bodyOf(/const resumeListening = useCallback\(\(\) =>/, 'resumeListening');
const acquireMic = bodyOf(/const acquireMic = useCallback\(/, 'acquireMic');
const stopActive = bodyOf(/const stopActive = useCallback\(\(\) =>/, 'stopActive');
const startActive = bodyOf(/const startActive = useCallback\(async \(\) =>/, 'startActive');

describe('V1 — a mic re-acquire cannot orphan the recognizer', () => {
  it('acquireMic tears the recognizer down instead of just forgetting it', () => {
    expect(acquireMic).toContain('teardownRecognition();');
    // Forgetting it was the bug: the object kept running (mic hot after Stop)
    // and its results were dropped by the identity guards (session deaf).
    expect(acquireMic).not.toMatch(/recogRef\.current = null/);
  });

  it('teardown stops the engine and detaches its handlers before dropping the ref', () => {
    // Handlers first: engines fire onend asynchronously after stop(), and a
    // dying recognizer must not restart itself or clear the next one's state.
    const detach = teardown.indexOf('recog.onresult = null');
    const stop = teardown.indexOf('recog.stop()');
    const drop = teardown.indexOf('recogRef.current = null');
    expect(detach).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(detach);
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(detach); // ref dropped first, then detach + stop
    expect(teardown).toContain('recog.abort()'); // stop() can throw on some engines
  });

  it('acquireMic gives a still-listening session its recognizer back', () => {
    expect(acquireMic).toContain('startRecognitionRef.current()');
    // Only while the session is meant to be listening: rebuilding mid-reply
    // would let the microphone hear our own voice.
    expect(acquireMic).toMatch(/afterMic\.isActive/);
    expect(acquireMic).toMatch(/!speakingRef\.current/);
    expect(acquireMic).toMatch(/!processingRef\.current/);
  });

  it('resumeListening rebuilds when there is nothing left to resume', () => {
    expect(resumeListening).toMatch(/if \(!recog\) \{[\s\S]*startRecognitionRef\.current\(\);/);
    // A resumed session that is not active must not open the microphone.
    expect(resumeListening).toMatch(/if \(!st\.isActive[\s\S]*\) return;/);
  });

  it('stopActive tears the recognizer down, so Stop really releases the mic', () => {
    expect(stopActive).toContain('teardownRecognition();');
  });

  it('the recognizer is built from the current settings, not a stale snapshot', () => {
    expect(startRecognition).toContain('useAssistantStore.getState().settings');
    expect(startRecognition).not.toMatch(/store\.settings\./);
  });

  it('devicechange is listened for while a session runs and removed when it ends', () => {
    expect(startActive).toContain('navigator.mediaDevices.addEventListener("devicechange"');
    expect(stopActive).toContain('navigator.mediaDevices.removeEventListener("devicechange"');
  });
});

describe('V2 — a deaf engine is detected, retried once, then reported', () => {
  it('arms a watchdog after every start and clears it when the engine comes up', () => {
    expect(startRecognition).toContain('RECOG_START_TIMEOUT_MS');
    expect(startRecognition).toMatch(/recog\.onstart = \(\) => \{[\s\S]*clearTimeout\(watchdogTimerRef\.current\)/);
  });

  it('keeps its one-rebuild budget across the rebuild itself', () => {
    // Clearing the budget in teardown would rebuild every 8 s forever and the
    // person would never be told anything.
    expect(teardown).not.toContain('watchdogTriedRef.current = false');
    expect(startRecognition).toContain('watchdogTriedRef.current = false'); // onstart: engine is up
    expect(startActive).toContain('watchdogTriedRef.current = false'); // a new session starts over
    expect(startRecognition).toContain('DEAF_SESSION_NOTICE');
  });

  it('tells the person when nothing is being heard, in words', () => {
    expect(hook).toMatch(/const DEAF_SESSION_NOTICE =\s*\n?\s*"[^"]*(heard|hearing)[^"]*"/);
    expect(hook).toMatch(/const NO_SPEECH_NOTICE =\s*\n?\s*"[^"]*heard[^"]*"/);
  });
});

describe('V3 — engine error codes mean something to the person', () => {
  it('falls back once when the engine has no model for the chosen language', () => {
    expect(startRecognition).toContain('"language-not-supported"');
    expect(startRecognition).toMatch(/recogLangFallbackRef\.current = "en-IN"/);
    expect(startRecognition).toMatch(/language-not-supported[\s\S]*startRecognitionRef\.current\(\)/);
    // The fallback is offered once; a second failure must not loop.
    expect(startRecognition).toMatch(/if \(!recogLangFallbackRef\.current\) \{/);
    // The recognizer honours the fallback.
    expect(startRecognition).toMatch(/recog\.lang =\s*\n?\s*recogLangFallbackRef\.current \|\|/);
    expect(startActive).toContain('recogLangFallbackRef.current = null'); // new session re-tries
  });

  it('counts engine silence and says so, instead of blaming the person', () => {
    expect(startRecognition).toContain('"no-speech"');
    expect(startRecognition).toContain('NO_SPEECH_NOTICE_AFTER');
    // Hearing anything withdraws the notice.
    expect(startRecognition).toMatch(/recog\.onresult[\s\S]*noSpeechRef\.current = 0/);
    expect(startRecognition).toMatch(/micNotice === NO_SPEECH_NOTICE[\s\S]*setMicNotice\(null\)/);
  });

  it('treats our own abort as normal, not as an error', () => {
    expect(startRecognition).toMatch(/else if \(err === "aborted"\) \{/);
  });
});

describe('V4 — signing in does not kill a live session', () => {
  it('only a real identity change ends the session', () => {
    expect(hook).toContain('DEVICE_HISTORY_KEY');
    expect(hook).toMatch(
      /const becameIdentified =\s*\n?\s*previous === DEVICE_HISTORY_KEY && historyKey !== DEVICE_HISTORY_KEY;/,
    );
    // "device" -> an account id is the same person becoming identifiable, so it
    // must not reach stopActive.
    expect(hook).toMatch(/if \(previous !== historyKey && !becameIdentified\) \{[\s\S]*stopActive\(\)/);
  });
});

describe('V5 — only the reply that claimed the mic guard may release it', () => {
  it('tokens speakingRef instead of flipping a shared boolean', () => {
    expect(hook).toContain('const speakingToken = ++speakingTokenRef.current;');
    expect(hook).toMatch(
      /if \(speakingTokenRef\.current === speakingToken\)\s*\n?\s*speakingRef\.current = false;/,
    );
  });
});

describe('V6 — Settings changes reach a running session', () => {
  it('rebuilds the recognizer when the language or the end-of-speech wait changes', () => {
    expect(hook).toMatch(
      /\}, \[store\.settings\.language, store\.settings\.endOfSpeechMs\]\);/,
    );
    expect(hook).toMatch(/settings changed[\s\S]{0,200}startRecognitionRef\.current\(\)/);
    // Nothing running, nothing to rebuild — the next start builds fresh.
    expect(hook).toMatch(/if \(!recogRef\.current\) return;[^\n]*\n?[^\n]*logBgEvent\("recog-rebuild", "settings changed"\)/);
  });
});
