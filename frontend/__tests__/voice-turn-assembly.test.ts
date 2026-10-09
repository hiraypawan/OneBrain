// Regressions for the reported bug: "when I speak something long it only
// listens to the first 2-3 words and replies to that".
//
// Two real-device behaviours caused it, and neither is visible in a unit test
// that only pushes results in one uninterrupted stream:
//
//  1. The engine marks a result `isFinal` at every clause boundary, so a
//     thinking pause longer than the end-of-speech wait sent the half a
//     sentence that had been heard so far ("remind me to call the bank and").
//  2. Android Chrome ends the continuous session after each phrase and is
//     restarted by the app. That restart gap is silence the *app* caused, not
//     the person stopping — but the countdown kept running through it, so the
//     first words were answered alone while the mic was actually deaf.
//
// The assembler must therefore wait for the person, not for the recognizer.
import { describe, expect, it, vi } from 'vitest';
import {
  createUtteranceAssembler,
  looksIncomplete,
  INCOMPLETE_EXTENSION_MS_DEFAULT,
  MAX_SILENCE_MS_DEFAULT,
} from '../lib/transcript-gate';

function asm(opts: Record<string, unknown> = {}) {
  let t = 0;
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let id = 0;
  const onAccept = vi.fn();
  const a = createUtteranceAssembler({
    onAccept,
    silenceMs: 1600,
    now: () => t,
    setTimer: (fn, ms) => {
      timers.push({ fn, at: t + ms, id: ++id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((x) => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    ...opts,
  });
  const advance = (ms: number) => {
    // Step in small slices so a poll/re-arm cycle is exercised like a real clock.
    const step = 50;
    for (let left = ms; left > 0; left -= step) {
      const slice = Math.min(step, left);
      t += slice;
      for (const x of [...timers].sort((p, q) => p.at - q.at)) {
        if (x.at <= t) {
          timers.splice(timers.indexOf(x), 1);
          x.fn();
        }
      }
    }
  };
  return { a, onAccept, advance, clock: () => t };
}

describe('looksIncomplete — does the sentence need more words?', () => {
  it('flags dangling connectives, prepositions and articles', () => {
    for (const s of [
      'remind me to call the bank and',
      'I want to book a flight from',
      'the reason is that',
      'mujhe ek',
      'kal subah ka',
      'aur phir',
      'book a ticket for',
    ]) {
      expect(looksIncomplete(s), s).toBe(true);
    }
  });
  it('flags a trailing operator, comma or unbalanced quote', () => {
    expect(looksIncomplete('20 +')).toBe(true);
    expect(looksIncomplete('send a message to ravi,')).toBe(true);
    expect(looksIncomplete('search for "best phones')).toBe(true);
  });
  it('does NOT flag finished sentences or short commands', () => {
    for (const s of [
      'what is the weather tomorrow',
      'remind me to call mom at 6',
      'theek hai',
      'time kya hai',
      'yes',
      'stop',
      'haan',
      '20 + 4',
    ]) {
      expect(looksIncomplete(s), s).toBe(false);
    }
  });
});

describe('a long turn is heard to the end', () => {
  it('waits for the rest of a sentence that is obviously unfinished', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'remind me to call the bank and', confidence: 0.9 });
    // The plain wait would have sent "…and" on its own. It must not.
    advance(1600);
    expect(onAccept).not.toHaveBeenCalled();
    advance(INCOMPLETE_EXTENSION_MS_DEFAULT - 200);
    expect(onAccept).not.toHaveBeenCalled();
    a.push({ isFinal: true, transcript: 'ask about my loan', confidence: 0.9 });
    advance(1600);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('remind me to call the bank and ask about my loan', 0.9);
  });

  it('gives up waiting after the hard ceiling instead of holding the turn forever', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'and then the', confidence: 0.9 });
    advance(MAX_SILENCE_MS_DEFAULT + 500);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('and then the', 0.9);
  });

  it('hears a whole long request across clause pauses', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: false, transcript: 'I need to' });
    advance(600);
    a.push({ isFinal: true, transcript: 'I need to book a cab', confidence: 0.86 });
    advance(1000); // clause pause, shorter than the wait
    expect(onAccept).not.toHaveBeenCalled();
    a.push({ isFinal: false, transcript: 'from the office' });
    advance(400);
    a.push({ isFinal: true, transcript: 'from the office to the airport', confidence: 0.9 });
    advance(1600);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(
      'I need to book a cab from the office to the airport',
      0.86,
    );
  });

  it('does not send the first words while the recognizer is restarting', () => {
    const { a, onAccept, advance } = asm();
    a.push({ isFinal: true, transcript: 'I want to book', confidence: 0 });
    // Android ended the session; the app is starting a new one. A real restart
    // takes well under a second, and this silence belongs to the recognizer,
    // not to the person — so it must not end the turn.
    a.pause();
    expect(a.isPaused()).toBe(true);
    advance(2500);
    expect(onAccept).not.toHaveBeenCalled();
    a.resume();
    expect(a.isPaused()).toBe(false);
    a.push({ isFinal: true, transcript: 'a flight to Delhi on Monday', confidence: 0 });
    advance(1600);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('I want to book a flight to Delhi on Monday', undefined);
  });

  it('still delivers the turn if the recognizer never comes back', () => {
    const { a, onAccept, advance } = asm({ pausedGraceMs: 1200 });
    a.push({ isFinal: true, transcript: 'call the plumber', confidence: 0.9 });
    a.pause();
    advance(1000);
    expect(onAccept).not.toHaveBeenCalled();
    advance(1000);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('call the plumber', 0.9);
  });

  it('keeps the turn open while the microphone still hears voice', () => {
    let talking = true;
    const { a, onAccept, advance } = asm({ speechActive: () => talking });
    a.push({ isFinal: true, transcript: 'make a list of groceries', confidence: 0.9 });
    // The words stopped arriving but the room is still carrying voice: the
    // recognizer dropped a result, the person did not stop.
    advance(3000);
    expect(onAccept).not.toHaveBeenCalled();
    talking = false;
    advance(1600);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('make a list of groceries', 0.9);
  });

  it('reads the wait live, so a room that got noisy waits longer mid-session', () => {
    let wait = 900;
    const { a, onAccept, advance } = asm({ silenceMs: () => wait });
    a.push({ isFinal: true, transcript: 'play some music', confidence: 0.9 });
    wait = 2400; // the room changed after the session started
    advance(1200);
    expect(onAccept).not.toHaveBeenCalled();
    advance(1300);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('play some music', 0.9);
  });
});
