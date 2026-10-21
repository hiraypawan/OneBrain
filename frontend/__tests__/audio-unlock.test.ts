import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  audioUnlockState,
  isActivationEvent,
  preferPlaybackAudioSession,
  primeAudioOutputOnGesture,
  primeSpeechSynthesis,
  resetAudioUnlockState,
  speechAudioElement,
  speechCeilingMs,
  unlockAudioOutput,
  SILENT_WAV,
} from '../lib/audio';

// ---------------------------------------------------------------------------
// A small model of iOS WebKit, so the unlock is tested against the real rule:
//  * SpeechSynthesis::speak() returns early — no event, nothing queued — while
//    RequireUserGestureForSpeechStart is set, and only a speak() made while
//    processing a user gesture clears it (cancel() never sets it again);
//  * a media element's play() rejects until play() is called in a gesture.
// "In a gesture" = synchronously inside an activation-triggering event.
// ---------------------------------------------------------------------------
let inGesture = false;

class FakeUtterance {
  text: string;
  volume = 1;
  constructor(text: string) {
    this.text = text;
  }
}

class WebKitSynth {
  restricted = true;
  speaking = false;
  pending = false;
  queue: FakeUtterance[] = [];
  dropped = 0;
  speak(u: FakeUtterance) {
    if (inGesture) this.restricted = false;
    else if (this.restricted) {
      this.dropped += 1;
      return;
    }
    this.queue.push(u);
  }
  cancel() {
    this.queue = [];
    this.speaking = false;
  }
}

let refuseNextPlay = false;
class WebKitAudio {
  src = '';
  paused = true;
  currentTime = 0;
  preload = '';
  allowed = false;
  plays = 0;
  setAttribute() {}
  play() {
    this.plays += 1;
    if (refuseNextPlay) {
      refuseNextPlay = false;
      return Promise.reject(new Error('NotAllowedError'));
    }
    if (inGesture) this.allowed = true;
    if (!this.allowed) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

/** Minimal event target that dispatches capture listeners synchronously. */
function fakeDocument() {
  const listeners = new Map<string, Set<(ev: any) => void>>();
  return {
    addEventListener(type: string, fn: (ev: any) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      listeners.get(type)?.delete(fn);
    },
    count() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
    /** Dispatch like WebKit: activation events run inside a gesture. */
    dispatch(type: string, extra: Record<string, unknown> = {}) {
      const ev = { type, isTrusted: true, ...extra };
      const pointerType = String((extra as any).pointerType || '');
      inGesture =
        ['click', 'touchend', 'mousedown', 'keydown'].includes(type) ||
        (type === 'pointerup' && pointerType !== 'mouse') ||
        (type === 'pointerdown' && pointerType === 'mouse');
      try {
        for (const fn of [...(listeners.get(type) || [])]) fn(ev);
      } finally {
        inGesture = false;
      }
    },
  };
}

let synth: WebKitSynth;

beforeEach(() => {
  resetAudioUnlockState();
  inGesture = false;
  refuseNextPlay = false;
  synth = new WebKitSynth();
  vi.stubGlobal('window', { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance });
  vi.stubGlobal('Audio', WebKitAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAudioUnlockState();
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const reply = () => new FakeUtterance('Here is your answer.');

describe('the iOS speech lock (the "queued but never started" bug)', () => {
  it('drops a reply spoken without any unlock — the reported symptom', () => {
    synth.speak(reply());
    expect(synth.queue).toHaveLength(0);
    expect(synth.dropped).toBe(1);
  });

  it('unlockAudioOutput() inside a tap unlocks the engine synchronously, so a later reply plays', async () => {
    inGesture = true;
    const confirmed = unlockAudioOutput();
    inGesture = false;
    expect(synth.restricted).toBe(false);
    expect(audioUnlockState().speech).toBe(true);
    await expect(confirmed).resolves.toBe(true);
    // Much later, after the network round trip, outside any gesture:
    synth.cancel();
    synth.speak(reply());
    expect(synth.queue.map((u) => u.text)).toEqual(['Here is your answer.']);
  });

  it('priming after an await (the old unlock order) would have been dropped', async () => {
    inGesture = true;
    const pending = Promise.resolve();
    inGesture = false;
    await pending;
    primeSpeechSynthesis();
    expect(synth.restricted).toBe(true);
  });

  it('does not queue a primer behind (or disturb) a reply that is already speaking', () => {
    synth.restricted = false;
    synth.speaking = true;
    expect(primeSpeechSynthesis()).toBe(true);
    expect(synth.queue).toHaveLength(0);
  });

  it('reports no engine instead of throwing', () => {
    vi.stubGlobal('window', {});
    expect(primeSpeechSynthesis()).toBe(false);
  });
});

describe('primeAudioOutputOnGesture', () => {
  it('ignores a touch pointerdown and unlocks on the touchend of the same tap', async () => {
    const doc = fakeDocument();
    primeAudioOutputOnGesture(doc);
    doc.dispatch('pointerdown', { pointerType: 'touch' });
    expect(synth.restricted).toBe(true);
    expect((speechAudioElement() as unknown as WebKitAudio).plays).toBe(0);
    doc.dispatch('touchend');
    expect(synth.restricted).toBe(false);
    await flush();
    expect(audioUnlockState()).toEqual({ speech: true, media: true });
    // Both unlocked: the listeners are gone.
    expect(doc.count()).toBe(0);
  });

  it('keeps listening after a refused play() and unlocks on the next tap', async () => {
    const doc = fakeDocument();
    primeAudioOutputOnGesture(doc);
    refuseNextPlay = true;
    doc.dispatch('click');
    await flush();
    expect(audioUnlockState()).toEqual({ speech: true, media: false });
    expect(doc.count()).toBeGreaterThan(0);
    doc.dispatch('click');
    await flush();
    expect(audioUnlockState().media).toBe(true);
    expect(doc.count()).toBe(0);
  });

  it('unlocks from a keyboard (Enter to send) but not from Escape or synthetic events', async () => {
    const doc = fakeDocument();
    primeAudioOutputOnGesture(doc);
    doc.dispatch('keydown', { key: 'Escape' });
    doc.dispatch('click', { isTrusted: false });
    expect(audioUnlockState().speech).toBe(false);
    doc.dispatch('keydown', { key: 'Enter' });
    expect(audioUnlockState().speech).toBe(true);
  });

  it('can be released before any gesture', () => {
    const doc = fakeDocument();
    const release = primeAudioOutputOnGesture(doc);
    expect(doc.count()).toBeGreaterThan(0);
    release();
    expect(doc.count()).toBe(0);
  });

  it('is a no-op without a document', () => {
    expect(() => primeAudioOutputOnGesture(null)()).not.toThrow();
  });
});

describe('unlockAudioOutput and the shared element', () => {
  it('never pauses or replaces a reply that is playing', async () => {
    const el = speechAudioElement() as unknown as WebKitAudio;
    el.src = 'blob:reply';
    el.paused = false;
    await expect(unlockAudioOutput()).resolves.toBe(true);
    expect(el.src).toBe('blob:reply');
    expect(el.paused).toBe(false);
    expect(el.plays).toBe(0);
  });

  it('plays the silent clip (not a stale, revoked reply URL) to unlock', async () => {
    const el = speechAudioElement() as unknown as WebKitAudio;
    el.src = 'blob:revoked-last-reply';
    inGesture = true;
    const done = unlockAudioOutput();
    inGesture = false;
    expect(el.src).toBe(SILENT_WAV);
    await expect(done).resolves.toBe(true);
    expect(el.paused).toBe(true);
  });

  it('reports false when the browser refuses playback', async () => {
    await expect(unlockAudioOutput()).resolves.toBe(false);
    expect(audioUnlockState().media).toBe(false);
  });
});

describe('isActivationEvent', () => {
  it('follows the HTML activation-triggering event list', () => {
    expect(isActivationEvent({ type: 'click' })).toBe(true);
    expect(isActivationEvent({ type: 'touchend' })).toBe(true);
    expect(isActivationEvent({ type: 'mousedown' })).toBe(true);
    expect(isActivationEvent({ type: 'keydown', key: 'a' })).toBe(true);
    expect(isActivationEvent({ type: 'keydown', key: 'Escape' })).toBe(false);
    expect(isActivationEvent({ type: 'pointerdown', pointerType: 'mouse' })).toBe(true);
    expect(isActivationEvent({ type: 'pointerdown', pointerType: 'touch' })).toBe(false);
    expect(isActivationEvent({ type: 'pointerup', pointerType: 'touch' })).toBe(true);
    expect(isActivationEvent({ type: 'pointerup', pointerType: 'mouse' })).toBe(false);
    expect(isActivationEvent({ type: 'touchstart' })).toBe(false);
    expect(isActivationEvent({ type: 'click', isTrusted: false })).toBe(false);
    expect(isActivationEvent(null)).toBe(false);
  });
});

describe('preferPlaybackAudioSession', () => {
  it('asks for a playback session only from "auto", and restores it', () => {
    const audioSession = { type: 'auto' };
    vi.stubGlobal('navigator', { audioSession });
    const restore = preferPlaybackAudioSession();
    expect(audioSession.type).toBe('playback');
    restore();
    expect(audioSession.type).toBe('auto');
  });

  it('leaves a deliberately chosen session alone (e.g. play-and-record while listening)', () => {
    const audioSession = { type: 'play-and-record' };
    vi.stubGlobal('navigator', { audioSession });
    preferPlaybackAudioSession()();
    expect(audioSession.type).toBe('play-and-record');
  });

  it('is a no-op where the Audio Session API does not exist', () => {
    vi.stubGlobal('navigator', {});
    expect(() => preferPlaybackAudioSession()()).not.toThrow();
  });
});

describe('speechCeilingMs', () => {
  it('never cuts a long answer short, before or after metadata', () => {
    // ~60 s of 32 kbps speech MP3 (~240 kB), duration not known yet.
    expect(speechCeilingMs(240_000, NaN)).toBeGreaterThanOrEqual(120_000);
    // Duration known and longer than the size estimate (e.g. compact codec).
    expect(speechCeilingMs(20_000, 95)).toBeGreaterThanOrEqual(100_000);
  });

  it('stays within sane bounds', () => {
    expect(speechCeilingMs(0, NaN)).toBe(10_000);
    expect(speechCeilingMs(1e12, 1e9)).toBe(600_000);
  });
});
