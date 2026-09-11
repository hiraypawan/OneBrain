import { describe, it, expect } from 'vitest';
import { transliterate, normalizeHinglish, hasDevanagari } from '../lib/transliterate';

describe('transliterate', () => {
  it('converts common Hindi to Roman Hinglish', () => {
    expect(transliterate('नमस्ते')).toBe('namaste');
    expect(transliterate('कमल')).toBe('kamal');
    expect(transliterate('भारत')).toBe('bhaarat');
    expect(transliterate('हेलो हेलो')).toBe('helo helo');
  });

  it('handles conjuncts, nukta and digits', () => {
    expect(transliterate('स्टेशन')).toBe('steshan');
    expect(transliterate('पुलिस')).toBe('pulis');
    expect(transliterate('१२')).toBe('12');
  });

  it('leaves Latin text untouched', () => {
    expect(transliterate('What time is it?')).toBe('What time is it?');
    expect(transliterate('')).toBe('');
  });

  it('detects Devanagari presence', () => {
    expect(hasDevanagari('abc')).toBe(false);
    expect(hasDevanagari('अब')).toBe(true);
  });
});

describe('normalizeHinglish', () => {
  it('repairs misheard English words', () => {
    expect(normalizeHinglish('टाइम क्या है')).toBe('time kya hai');
    expect(normalizeHinglish('व्हाट इज द टाइम')).toBe('what is the time');
    expect(normalizeHinglish('पुलिस स्टेशन कहां है')).toBe('police station kahan hai');
  });

  it('keeps ordinary Hinglish as-is', () => {
    expect(normalizeHinglish('aap kaise ho')).toBe('aap kaise ho');
  });
});
