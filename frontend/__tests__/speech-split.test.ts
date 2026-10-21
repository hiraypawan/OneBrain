import { describe, it, expect } from 'vitest';
import { splitForProgressiveSpeech, splitForSpeech } from '../lib/speech-split';
import { splitForSpeech as reExported } from '../lib/speech';

const long = Array.from({ length: 40 }, (_, i) => `This is sentence ${i + 1}, part of a long answer.`).join(' ');

describe('splitForProgressiveSpeech', () => {
  it('keeps a short answer in one piece', () => {
    expect(splitForProgressiveSpeech('  Hello   there. ')).toEqual(['Hello there.']);
    expect(splitForProgressiveSpeech('')).toEqual([]);
  });

  it('starts with a short piece so the first words are heard quickly', () => {
    const pieces = splitForProgressiveSpeech(long, 220, 900);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces[0].length).toBeLessThanOrEqual(220);
    expect(pieces[0].endsWith('.')).toBe(true);
    for (const p of pieces.slice(1)) expect(p.length).toBeLessThanOrEqual(900);
    // Larger pieces after the first one: fewer fetches for the rest.
    expect(pieces[1].length).toBeGreaterThan(pieces[0].length);
  });

  it('never drops or repeats words', () => {
    expect(splitForProgressiveSpeech(long, 220, 900).join(' ')).toBe(long);
    const oneSentence = 'word '.repeat(300).trim();
    expect(splitForProgressiveSpeech(oneSentence, 220, 900).join(' ')).toBe(oneSentence);
  });
});

describe('splitForSpeech', () => {
  it('is the same function the browser voice has always used', () => {
    expect(reExported).toBe(splitForSpeech);
    expect(splitForSpeech(long, 180).every((p) => p.length <= 180)).toBe(true);
  });
});
