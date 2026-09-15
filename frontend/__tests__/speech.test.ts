import { describe, it, expect } from 'vitest';
import { cleanForSpeech, splitReply, splitForSpeech, ttsLangFor } from '../lib/speech';

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
