import { describe, it, expect } from 'vitest';
import { findNumber, findAllNumbers, wordsToNumber } from '../lib/numbers';

describe('wordsToNumber', () => {
  it('parses english words', () => {
    expect(wordsToNumber(['twenty'])).toBe(20);
    expect(wordsToNumber(['forty', 'two'])).toBe(42);
    expect(wordsToNumber(['one', 'hundred', 'and', 'five'])).toBe(105);
  });
  it('parses hindi words', () => {
    expect(wordsToNumber(['bees'])).toBe(20);
    expect(wordsToNumber(['do', 'sau', 'pachaas'])).toBe(250);
    expect(wordsToNumber(['ek', 'hazar'])).toBe(1000);
    expect(wordsToNumber(['do', 'lakh'])).toBe(200000);
    expect(wordsToNumber(['saat'])).toBe(7);
    expect(wordsToNumber(['sath'])).toBe(60);
  });
  it('rejects non-number runs', () => {
    expect(wordsToNumber(['pushups'])).toBeNull();
    expect(wordsToNumber([])).toBeNull();
  });
});

describe('findNumber', () => {
  it('finds digits', () => {
    expect(findNumber('20 pushups kar liye')?.value).toBe(20);
    expect(findNumber('kharcha 2,500 bijli')?.value).toBe(2500);
  });
  it('finds hindi words in sentences', () => {
    expect(findNumber('bees pushups kar liye')?.value).toBe(20);
    expect(findNumber('kharcha do sau chai')?.value).toBe(200);
  });
  it('prefers the earliest mention', () => {
    expect(findNumber('teen roti aur 2 parathe')?.value).toBe(3);
  });
  it('returns null without numbers', () => {
    expect(findNumber('pushups kar liye')).toBeNull();
  });
});

describe('findAllNumbers', () => {
  it('finds ordered numbers for ranges', () => {
    expect(findAllNumbers('30 sec on 10 off 8 rounds')).toEqual([30, 10, 8]);
  });
});
