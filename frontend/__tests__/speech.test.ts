import { describe, it, expect } from 'vitest';
import { cleanForSpeech, diagnoseTts, pickTtsVoice, splitReply, splitForSpeech, ttsLangFor, waitForVoices } from '../lib/speech';

describe('cleanForSpeech', () => {
  it('strips markdown but keeps the words', () => {
    expect(cleanForSpeech('India me abhi **Sunday, 6 September** hai.')).toBe(
      'India me abhi Sunday, 6 September hai.'
    );
    expect(cleanForSpeech('# Time\n- 8:48 pm\n- IST')).toMatch(/8:48 pm/);
    expect(cleanForSpeech('Try [this link](https://example.com/x) now')).toBe('Try this link now');
  });

  it('removes emojis and symbols users actually received', () => {
    const out = cleanForSpeech('Namaste! Main OneBrain hoon. Kaise help karun?');
    expect(out).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(out).toMatch(/Namaste/);
    expect(cleanForSpeech('Haan nice! Aap kya karna chahte ho?')).toMatch(/nice/);
  });

  it('turns line breaks into pauses and expands abbreviations', () => {
    expect(cleanForSpeech('Line one\nLine two')).toBe('Line one. Line two');
    expect(cleanForSpeech('e.g. time, date etc.')).toMatch(/for example/);
  });

  it('leaves plain Hinglish untouched', () => {
    const s = 'India me abhi 8:48 pm IST hai, aur 3:18 pm UTC.';
    expect(cleanForSpeech(s)).toBe(s);
  });
});

describe('splitReply', () => {
  it('splits spoken and English parts', () => {
    const r = splitReply('Aaj Sunday hai.\n---EN---\nToday is Sunday.');
    expect(r.spoken).toBe('Aaj Sunday hai.');
    expect(r.english).toBe('Today is Sunday.');
  });

  it('returns everything as spoken when no marker', () => {
    const r = splitReply('Just English here.');
    expect(r.spoken).toBe('Just English here.');
    expect(r.english).toBeNull();
  });
});

describe('ttsLangFor', () => {
  it('matches Devanagari to Hindi/Marathi voices', () => {
    expect(ttsLangFor('आज Sunday है', 'hinglish')).toBe('hi-IN');
    expect(ttsLangFor('आज Sunday आहे', 'marathi')).toBe('mr-IN');
  });

  it('keeps English in English', () => {
    expect(ttsLangFor('Today is Sunday', 'hinglish')).toBe('en-IN');
  });
});

describe('splitForSpeech', () => {
  it('keeps short replies as a single utterance', () => {
    expect(splitForSpeech('Namaste! Main sun raha hoon.')).toEqual(['Namaste! Main sun raha hoon.']);
    expect(splitForSpeech('   ')).toEqual([]);
  });

  it('splits long replies on sentence boundaries under the limit', () => {
    const reply = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} is here and it is fairly long.`).join(' ');
    const chunks = splitForSpeech(reply, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120);
      expect(c).toMatch(/\.$/);
    }
    expect(chunks.join(' ')).toBe(reply);
  });

  it('handles the Devanagari danda and never splits inside a word', () => {
    const reply = 'आज रविवार है। कल सोमवार होगा। ' + 'यह एक लंबा वाक्य है '.repeat(12).trim() + '।';
    const chunks = splitForSpeech(reply, 60);
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(reply.replace(/\s+/g, ' '));
  });

  it('breaks one enormous sentence on clauses, then words', () => {
    const reply = ('word '.repeat(50) + ', ').repeat(3).trim();
    const chunks = splitForSpeech(reply, 100);
    expect(chunks.every((c) => c.length <= 100 && !/^\s|\s$/.test(c))).toBe(true);
    expect(chunks.join(' ').split(' ').filter(Boolean).length).toBe(reply.split(' ').filter(Boolean).length);
  });
});

// --- Voice availability (why "he doesn't talk" must never be silent) --------

describe('pickTtsVoice', () => {
  const voices = [
    { name: 'Google हिन्दी', lang: 'hi-IN' },
    { name: 'Google English (India)', lang: 'en-IN' },
    { name: 'Microsoft Ravi', lang: 'hi-Latn-IN' },
  ];

  it('returns the exact voice when the language is installed', () => {
    const c = pickTtsVoice(voices, 'hi-IN');
    expect(c.match).toBe('exact');
    expect(c.voice?.name).toBe('Google हिन्दी');
    expect(c.lang).toBe('hi-in');
  });

  it('accepts a different script/region of the same language', () => {
    const c = pickTtsVoice([{ name: 'Ravi', lang: 'hi-Latn-IN' }], 'hi-IN');
    expect(c.match).toBe('language');
    expect(c.voice?.name).toBe('Ravi');
  });

  it('falls back to a related script (Marathi -> Hindi) instead of silence', () => {
    const c = pickTtsVoice(voices, 'mr-IN');
    expect(c.match).toBe('related');
    expect(c.voice?.lang).toBe('hi-IN');
  });

  it('uses any available voice when the language family is absent', () => {
    const c = pickTtsVoice([{ name: 'Google UK', lang: 'en-GB' }], 'mr-IN');
    expect(c.match).toBe('any');
    expect(c.voice?.name).toBe('Google UK');
  });

  it('prefers Indian English for the generic fallback', () => {
    const c = pickTtsVoice([{ name: 'US', lang: 'en-US' }, { name: 'IN', lang: 'en-IN' }], 'ta-IN');
    expect(c.match).toBe('any');
    expect(c.voice?.name).toBe('IN');
  });

  it('reports none when the engine has no voices at all', () => {
    expect(pickTtsVoice([], 'en-IN').match).toBe('none');
    expect(pickTtsVoice(undefined, 'en-IN').voice).toBeNull();
  });

  it('treats underscore/case variants as the same tag', () => {
    expect(pickTtsVoice([{ name: 'ES', lang: 'ES_es' }], 'es-ES').match).toBe('exact');
  });
});

describe('waitForVoices', () => {
  it('resolves immediately when voices are already available', async () => {
    const synth = { getVoices: () => [{ lang: 'en-IN', name: 'a' }] };
    await expect(waitForVoices(synth, 100)).resolves.toHaveLength(1);
  });

  it('resolves with [] when there is no engine instead of throwing', async () => {
    await expect(waitForVoices(undefined, 50)).resolves.toEqual([]);
    await expect(waitForVoices({ getVoices: () => { throw new Error('x'); } }, 50)).resolves.toEqual([]);
  });

  it('waits for voiceschanged when Chrome answers empty first', async () => {
    let voices: any[] = [];
    const handlers: Array<() => void> = [];
    const synth = {
      getVoices: () => voices,
      addEventListener: (_e: string, cb: () => void) => handlers.push(cb),
      removeEventListener: () => {},
    };
    const p = waitForVoices(synth, 2000);
    voices = [{ lang: 'hi-IN', name: 'late' }];
    handlers.forEach((h) => h());
    await expect(p).resolves.toEqual([{ lang: 'hi-IN', name: 'late' }]);
  });
});

describe('diagnoseTts', () => {
  const enVoice = [{ lang: 'en-IN', name: 'Google English (India)' }];

  it('names Silent Mode as the reason nothing was spoken', () => {
    const h = diagnoseTts({ silentMode: true, voices: enVoice });
    expect(h.level).toBe('blocked');
    expect(h.code).toBe('silent-mode');
    expect(h.message).toMatch(/Silent Mode/);
    expect(h.hint).toMatch(/Turn off/);
  });

  it('reports a browser with no speech engine', () => {
    const h = diagnoseTts({ synthSupported: false, voices: enVoice });
    expect(h.code).toBe('unsupported');
    expect(h.message).toMatch(/no speech engine/);
  });

  it('reports a missing voice pack instead of staying quiet', () => {
    const h = diagnoseTts({ voices: [] });
    expect(h.level).toBe('blocked');
    expect(h.code).toBe('no-voices');
    expect(h.hint).toMatch(/Text-to-speech/);
  });

  it('warns when a substitute voice had to be used', () => {
    const h = diagnoseTts({
      voices: enVoice,
      choice: pickTtsVoice(enVoice, 'mr-IN'),
      lang: 'mr-IN',
    });
    expect(h.level).toBe('warn');
    expect(h.code).toBe('substitute-voice');
    expect(h.message).toMatch(/Google English \(India\)/);
  });

  it('stays quiet when everything is fine', () => {
    const h = diagnoseTts({ voices: enVoice, choice: pickTtsVoice(enVoice, 'en-IN'), lang: 'en-IN' });
    expect(h.level).toBe('ok');
    expect(h.message).toBeNull();
  });
});
