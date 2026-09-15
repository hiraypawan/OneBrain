import { describe, it, expect } from 'vitest';
import {
  detectLang, detectTranslatorIntent, translationPrompt, offlineTranslate, PAIRS,
} from '../lib/translate';

describe('detectLang', () => {
  it('detects scripts', () => {
    expect(detectLang('यह कितने का है?')).toBe('hi');
    expect(detectLang('how much is this')).toBe('en');
    expect(detectLang('he kiti la')).toBe('mr');
  });
});

describe('detectTranslatorIntent', () => {
  it('enters, swaps, pairs and exits', () => {
    expect(detectTranslatorIntent('translator mode on')).toEqual({ action: 'enter' });
    expect(detectTranslatorIntent('translate karo')).toEqual({ action: 'enter' });
    expect(detectTranslatorIntent('translator band')).toEqual({ action: 'exit' });
    expect(detectTranslatorIntent('swap language')).toEqual({ action: 'swap' });
    expect(detectTranslatorIntent('hindi to marathi')).toEqual({ action: 'pair', id: 'hi-mr' });
  });
  it('ignores chat', () => {
    expect(detectTranslatorIntent('namaste, kaise ho')).toBeNull();
  });
});

describe('translationPrompt', () => {
  it('is strict', () => {
    expect(translationPrompt('namaste', 'hi', 'en')).toMatch(/ONLY the translation/);
  });
});

describe('offlineTranslate', () => {
  it('covers market lines offline', () => {
    expect(offlineTranslate('yeh kitne ka hai', 'hi', 'en')).toBe('How much is this?');
    expect(offlineTranslate('namaste', 'hi', 'en')).toBe('Hello!');
    expect(offlineTranslate('How much is this?', 'en', 'hi')).toBe('Yeh kitne ka hai?');
  });
  it('returns null off-phrasebook', () => {
    expect(offlineTranslate('quantum entanglement samjhao', 'hi', 'en')).toBeNull();
  });
  it('ships pairs', () => {
    expect(PAIRS.map((p) => p.id)).toContain('hi-en');
  });
});
