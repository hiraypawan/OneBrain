import { describe, expect, it } from 'vitest';
import { findAllNumbers, findNumber, wordsToNumber } from '@/lib/numbers';

// Spoken-number collisions — audit finding I2, FIXED in Phase 2.
//
// lib/numbers.ts used to map Romanised Hindi number words straight onto English
// tokens with no context check, so `do` (2), `no` (9), `so` (100), `tin` (3),
// `bara` (12 — Hindi for "big"), `tera` (13 — Hindi for "your") and `sath` (60 —
// "together") made a number out of ordinary words. Two proven examples, both
// reproduced end-to-end in __tests__/intent-routing.test.ts:
//
//   "let us do 20 pushups"    -> logged a 2 Pushup workout (the 20 was lost)
//   "I spent no time on this" -> logged a ₹9 expense titled "I no time on this"
//
// An ambiguous word now counts only when the sentence confirms it: another
// number word next to it ("do sau"), or a counting unit ("do roti", "sath
// minute"). Bare, it reads as the ordinary word it usually is.
//
// These assertions are the ratchet in the other direction — they fail if the
// confirmation rule is ever loosened again.

/** Words that used to be read as numbers on their own. */
const AMBIGUOUS_ALONE = ['do', 'no', 'so', 'tin', 'bara', 'tera', 'teri', 'sath', 'saath', 'bees', 'tees'];

describe('findNumber — ambiguous words need a number context', () => {
  it.each(AMBIGUOUS_ALONE)('bare "%s" is not a number', (word) => {
    expect(findNumber(word)).toBeNull();
  });

  it('reads them as numbers when a counting unit follows', () => {
    expect(findNumber('do roti')?.value).toBe(2);
    expect(findNumber('no glass paani')?.value).toBe(9);
    expect(findNumber('so rupay kharch kiye')?.value).toBe(100);
    expect(findNumber('tin baar')?.value).toBe(3);
    expect(findNumber('bara plate khana')?.value).toBe(12);
    expect(findNumber('tera pushups')?.value).toBe(13);
    expect(findNumber('sath minute')?.value).toBe(60);
    expect(findNumber('bees kadam')?.value).toBe(20);
  });

  it('reads them as numbers inside a longer number run', () => {
    expect(findNumber('do sau pachaas')?.value).toBe(250);
    expect(findNumber('sath hazaar')?.value).toBe(60000);
    expect(findNumber('tera sau')?.value).toBe(1300);
  });

  it('the sentences that used to be misread now find the real number, or none', () => {
    expect(findNumber('let us do 20 pushups')).toMatchObject({ value: 20, raw: '20' });
    expect(findAllNumbers('let us do 20 pushups')).toEqual([20]);
    expect(findNumber('I spent no time on this')).toBeNull();
    expect(findNumber('so what do you think')).toBeNull();
    expect(findNumber('no idea')).toBeNull();
    expect(findNumber('tera naam kya hai')).toBeNull();
    expect(findNumber('it is in the tin')).toBeNull();
    expect(findNumber('hum sath chalein')).toBeNull();
  });

  it('a repair sentence can still ask for an ambiguous word explicitly', () => {
    // detectLogRepair passes { allowAmbiguous: true } because "last wala saath
    // kar do" names the row and asks for a number.
    expect(findNumber('last wala saath kar do', { allowAmbiguous: true })?.value).toBe(7);
    expect(findNumber('last wala saath kar do')).toBeNull();
  });

  it('che still reads as 6 (recorded, not yet gated)', () => {
    // "che din ho gaye" is a real number phrase, and `din` is a counting unit,
    // so gating `che` would need a wider unit list first. Left as recorded.
    expect(findNumber('che')?.value).toBe(6);
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
