import { describe, it, expect } from 'vitest';
import { cleanForSpeech, splitReply, ttsLangFor } from '../lib/speech';

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
