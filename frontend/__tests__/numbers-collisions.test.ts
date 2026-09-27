import { describe, expect, it } from 'vitest';
import { findAllNumbers, findNumber, wordsToNumber } from '@/lib/numbers';

// Spoken-number collisions — audit finding I2.
//
// lib/numbers.ts maps Romanised Hindi number words straight onto English
// tokens, with no context check: `do` (2), `no` (9), `so` (100), `tin` (3),
// `bara` (12 — Hindi for "big"), `tera` (13 — Hindi for "your"), `sath` (60 —
// "together"). Any sentence containing those words carries a number in it, so
// the fitness/expense logger writes a value nobody said. Two proven examples,
// reproduced end-to-end in __tests__/intent-routing.test.ts:
//
//   "let us do 20 pushups"   -> logs a 2 Pushup workout (the 20 is lost)
//   "I spent no time on this" -> logs a ₹9 expense titled "I no time on this"
//
// This file is a ratchet, not an endorsement. Every row below records what the
// parser does TODAY. When a row starts failing, the collision is fixed — delete
// the row, do not update the number. The "must keep working" block at the
// bottom is the other half: it is what a fix has to keep passing.

/** English words that read as Hindi numbers. */
const ENGLISH_COLLISIONS: Record<string, number> = {
  do: 2, // "let us do 20 pushups"
  no: 9, // "I spent no time on this"
  so: 100, // "so much work today", also Hindi "slept"
  tin: 3, // "it is in the tin"
};

/** Hindi words that are not numbers but read as one. */
const HINGLISH_COLLISIONS: Record<string, number> = {
  bara: 12, // "big" — "bara kamra hai"
  tera: 13, // "your" — "tera phone kahan hai"
  sath: 60, // "together" — "sath chalein" (saath = 7, and transcripts rarely differ)
  che: 6, // "che din ho gaye" — which days?
};

describe('findNumber — recorded collisions (ratchet: delete a row when it fails)', () => {
  it.each(Object.entries(ENGLISH_COLLISIONS))('%s reads as %i', (word, value) => {
    expect(findNumber(word)?.value).toBe(value);
  });

  it.each(Object.entries(HINGLISH_COLLISIONS))('%s reads as %i', (word, value) => {
    expect(findNumber(word)?.value).toBe(value);
  });

  it('in a sentence, the first token wins — even when a better number follows', () => {
    expect(findNumber('let us do 20 pushups')).toMatchObject({ value: 2, raw: 'do' });
    expect(findAllNumbers('let us do 20 pushups')).toEqual([2, 20]);
  });

  it('a sentence with no number in it still finds one', () => {
    expect(findNumber('I spent no time on this')?.value).toBe(9);
    expect(findNumber('so what do you think')?.value).toBe(100);
    expect(findNumber('no idea')?.value).toBe(9);
    expect(findNumber('tera naam kya hai')?.value).toBe(13);
  });
});

describe('findNumber — must keep working (what a fix has to preserve)', () => {
  it('digits, with or without a Hindi label around them', () => {
    expect(findNumber('kharcha 200 chai')?.value).toBe(200);
    expect(findNumber('20 pushups kar liye')?.value).toBe(20);
    expect(findNumber('8 glass paani piya')?.value).toBe(8);
    expect(findNumber('6 ghante soya')?.value).toBe(6);
    expect(findNumber('set my monthly budget to 20000')?.value).toBe(20000);
  });

  it('number words that are unambiguously numbers', () => {
    expect(findNumber('teen roti khayi')?.value).toBe(3);
    expect(findNumber('paanch kilometer chala')?.value).toBe(5);
    expect(findNumber('do sau pachaas')?.value).toBe(250);
    expect(findNumber('ek hazaar')?.value).toBe(1000);
    expect(findNumber('nau baje')?.value).toBe(9);
    expect(findNumber('bis minute')?.value).toBe(20);
  });

  it('the earliest number wins when a sentence has several', () => {
    // Pinned by __tests__/features-numbers.test.ts as well.
    expect(findNumber('teen roti aur 2 parathe')?.value).toBe(3);
  });

  it('wordsToNumber still composes runs and rejects non-number words', () => {
    expect(wordsToNumber(['do', 'sau', 'pachaas'])).toBe(250);
    expect(wordsToNumber(['ek', 'hazaar', 'do', 'sau'])).toBe(1200);
    expect(wordsToNumber(['roti', 'khayi'])).toBeNull();
    expect(wordsToNumber([])).toBeNull();
  });

  it('finds nothing when there is nothing to find', () => {
    expect(findNumber('good morning')).toBeNull();
    expect(findNumber('')).toBeNull();
    expect(findAllNumbers('how are you')).toEqual([]);
  });
});
