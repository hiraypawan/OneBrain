import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { speakChunksWithBrowserVoice, utteranceVoicePlan, type VoiceChoice } from '../lib/speech';

beforeEach(() => {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth(behaviour: 'ok' | 'never-starts' | 'not-allowed') {
  const spoken: string[] = [];
  const calls: string[] = [];
  const synth: any = {
    speaking: false,
    pending: false,
    paused: false,
    calls,
    spoken,
    cancel() {
      calls.push('cancel');
    },
    resume() {},
    getVoices: () => [],
    speak(u: FakeUtterance) {
      calls.push('speak');
      spoken.push(u.text);
      if (behaviour === 'ok') {
        setTimeout(() => u.onstart?.(), 1);
        setTimeout(() => u.onend?.(), 5);
      }
      if (behaviour === 'not-allowed') {
        setTimeout(() => u.onerror?.({ error: 'not-allowed' }), 1);
      }
      // 'never-starts' fires nothing at all: the engine silently swallows it.
    },
  };
  return synth;
}

const voice: VoiceChoice = { voice: { name: 'Hindi', lang: 'hi-IN' }, match: 'exact', lang: 'hi-IN', name: 'Hindi' };

describe('utteranceVoicePlan', () => {
  it('keeps voice and lang consistent so engines do not go silent', () => {
    expect(utteranceVoicePlan({ voice: { lang: 'hi-IN' }, match: 'exact', lang: 'hi-IN', name: 'x' }, 'hi-IN'))
      .toEqual({ voice: { lang: 'hi-IN' }, lang: 'hi-IN' });
  });

  it('uses the substitute voice language when the requested language is missing', () => {
    const plan = utteranceVoicePlan({ voice: { lang: 'en-IN' }, match: 'any', lang: 'en-IN', name: 'x' }, 'mr-IN');
    expect(plan.lang).toBe('en-IN');
  });

  it('falls back to the requested language when no voice is installed', () => {
    expect(utteranceVoicePlan(null, 'mr-IN')).toEqual({ voice: null, lang: 'mr-IN' });
  });
});

describe('speakChunksWithBrowserVoice', () => {
  it('speaks every chunk and reports success', async () => {
    const synth = fakeSynth('ok');
    const outcome = await speakChunksWithBrowserVoice(synth, ['One.', 'Two.'], { rate: 1, choice: voice, lang: 'hi-IN' });
    expect(outcome).toBe('ok');
    expect(synth.spoken).toEqual(['One.', 'Two.']);
  });

  it('never calls speak() in the same tick as cancel() (the Safari silence bug)', async () => {
    const synth = fakeSynth('ok');
    let ticked = false;
    setTimeout(() => {
      ticked = true;
    }, 0);
    let spokeTooEarly = false;
    const original = synth.speak.bind(synth);
    synth.speak = (u: FakeUtterance) => {
      if (!ticked) spokeTooEarly = true;
      original(u);
    };
    await speakChunksWithBrowserVoice(synth, ['Hello.'], { rate: 1, choice: voice, lang: 'hi-IN' });
    expect(synth.calls[0]).toBe('cancel');
    expect(spokeTooEarly).toBe(false);
  });

  it('reports a stall instead of hanging, and retries once without the pinned voice', async () => {
    vi.useFakeTimers();
    const synth = fakeSynth('never-starts');
    const events: string[] = [];
    const promise = speakChunksWithBrowserVoice(synth, ['Silence.'], {
      rate: 1,
      choice: voice,
      lang: 'hi-IN',
      onEvent: (e) => events.push(e),
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await promise;
    expect(outcome).toBe('stalled');
    expect(events).toContain('stalled');
    expect(synth.spoken.length).toBe(2); // one attempt, one retry with engine default
  });

  it('surfaces a blocked-playback error with its code', async () => {
    const synth = fakeSynth('not-allowed');
    const events: [string, string | undefined][] = [];
    const outcome = await speakChunksWithBrowserVoice(synth, ['Blocked.'], {
      rate: 1,
      choice: voice,
      lang: 'hi-IN',
      onEvent: (e, d) => events.push([e, d]),
    });
    expect(outcome).toBe('error');
    expect(events.some(([e, d]) => e === 'error' && d === 'not-allowed')).toBe(true);
  });

  it('stops when a newer reply takes over', async () => {
    const synth = fakeSynth('ok');
    let current = true;
    const promise = speakChunksWithBrowserVoice(synth, ['One.', 'Two.', 'Three.'], {
      rate: 1,
      choice: voice,
      lang: 'hi-IN',
      isCurrent: () => current,
    });
    current = false;
    await expect(promise).resolves.toBe('cancelled');
  });

  it('reports an unsupported engine instead of pretending to speak', async () => {
    const outcome = await speakChunksWithBrowserVoice(undefined, ['Hi.'], { rate: 1, lang: 'en-IN' });
    expect(outcome).toBe('unsupported');
  });
});
