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

  it("keeps the engine's exact tag, not our lower-cased copy (Apple voices look it up verbatim)", () => {
    const rishi = { name: 'Rishi', lang: 'en-IN' };
    const plan = utteranceVoicePlan({ voice: rishi, match: 'exact', lang: 'en-in', name: 'Rishi' }, 'en-IN');
    expect(plan).toEqual({ voice: rishi, lang: 'en-IN' });
  });
});

describe('speakChunksWithBrowserVoice', () => {
  it('speaks every chunk and reports success', async () => {
    const synth = fakeSynth('ok');
    const outcome = await speakChunksWithBrowserVoice(synth, ['One.', 'Two.'], { rate: 1, choice: voice, lang: 'hi-IN' });
    expect(outcome).toBe('ok');
    expect(synth.spoken).toEqual(['One.', 'Two.']);
  });

  it('does not cancel an idle engine before speaking (cancel+speak is the Safari silence bug)', async () => {
    const synth = fakeSynth('ok');
    const outcome = await speakChunksWithBrowserVoice(synth, ['Hello.'], { rate: 1, choice: voice, lang: 'hi-IN' });
    expect(outcome).toBe('ok');
    expect(synth.calls).toEqual(['speak']);
  });

  it('clears a busy engine first and never speaks in the same tick as cancel()', async () => {
    const synth = fakeSynth('ok');
    synth.speaking = true;
    const cancel = synth.cancel.bind(synth);
    synth.cancel = () => {
      cancel();
      synth.speaking = false;
    };
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
    expect(synth.calls).toContain('speak');
    expect(spokeTooEarly).toBe(false);
  });

  it('reports the full length of a reply heard to the end (no bogus "continue" offer)', async () => {
    const synth = fakeSynth('ok');
    const progress: number[] = [];
    const chunks = ['First sentence here.', 'Second one.', 'Third.'];
    await speakChunksWithBrowserVoice(synth, chunks, { rate: 1, choice: voice, lang: 'hi-IN', onProgress: (n) => progress.push(n) });
    expect(progress.at(-1)).toBe(chunks.join(' ').length);
    expect(progress).toEqual([21, 33, 39]);
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
