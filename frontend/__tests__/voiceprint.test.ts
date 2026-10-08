import { describe, it, expect } from 'vitest';
import {
  detectPitch,
  median,
  rangeFromPitch,
  pitchSimilarity,
  isDifferentSpeaker,
  shouldIgnoreTranscript,
  synthVowel,
  learnBaseline,
} from '../lib/voiceprint';

const SR = 16000;

describe('detectPitch', () => {
  it('finds a male-range pitch (~120 Hz)', () => {
    const hz = detectPitch(synthVowel(120, SR, 0.5), SR);
    expect(hz).not.toBeNull();
    expect(Math.abs(hz! - 120)).toBeLessThan(8);
  });

  it('finds a female-range pitch (~210 Hz)', () => {
    const hz = detectPitch(synthVowel(210, SR, 0.5), SR);
    expect(hz).not.toBeNull();
    expect(Math.abs(hz! - 210)).toBeLessThan(12);
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(2048), SR)).toBeNull();
  });
});

describe('speaker helpers', () => {
  it('classifies vocal ranges', () => {
    expect(rangeFromPitch(120)).toBe('male');
    expect(rangeFromPitch(210)).toBe('female');
    expect(rangeFromPitch(null)).toBe('unknown');
    expect(rangeFromPitch(400)).toBe('unknown');
  });

  it('scores same-voice similarity high, different voices low', () => {
    expect(pitchSimilarity(120, 125)).toBeGreaterThan(0.8);
    expect(pitchSimilarity(120, 220)).toBeLessThan(0.5);
  });

  it('flags a different speaker only with a baseline', () => {
    expect(isDifferentSpeaker(null, 220)).toBe(false);
    expect(isDifferentSpeaker(120, 125)).toBe(false);
    expect(isDifferentSpeaker(120, 220)).toBe(true);
  });

  it('decides answer vs ignore before the AI call', () => {
    // Owner (or unknown voice): always answer.
    expect(shouldIgnoreTranscript({ baselineHz: 120, heardHz: 125, ownerOnly: true })).toBe('answer');
    expect(shouldIgnoreTranscript({ baselineHz: null, heardHz: 220, confidence: 0.4, ownerOnly: true })).toBe('answer');
    // Stranger + strict mode: drop with notice.
    expect(shouldIgnoreTranscript({ baselineHz: 120, heardHz: 220, confidence: 0.9, ownerOnly: true })).toBe('drop-notice');
    // Stranger + mumbling: drop silently (TV, other calls).
    expect(shouldIgnoreTranscript({ baselineHz: 120, heardHz: 220, confidence: 0.4, ownerOnly: false })).toBe('drop-silent');
    // Stranger but loud and clear: answer anyway, tagged.
    expect(shouldIgnoreTranscript({ baselineHz: 120, heardHz: 220, confidence: 0.9, ownerOnly: false })).toBe('answer');
  });

  it('computes medians for enrollment', () => {
    expect(median([120, 118, 500, 122, 119])).toBe(120);
    expect(median([])).toBeNull();
  });

  it('blends a new enrollment into the stored baseline instead of overwriting it', () => {
    expect(learnBaseline(null, [120, 122, 118])).toBe(120);
    expect(learnBaseline(120, [])).toBe(120);
    const blended = learnBaseline(120, [200, 200, 200]);
    expect(blended).toBeGreaterThan(120);
    expect(blended).toBeLessThan(200);
    // A single noisy sample must not jump the profile all the way to the sample.
    expect(learnBaseline(120, [400], { weight: 0.35 })).toBeCloseTo(120 + (400 - 120) * 0.35, 5);
  });

  it('lets a loud room require the enrolled voice even when strict mode is off', () => {
    expect(
      shouldIgnoreTranscript({
        baselineHz: 120,
        heardHz: 220,
        confidence: 0.95,
        ownerOnly: false,
        tuning: { requireOwnerVoice: true, ownerTolerance: 0.4, minConfidence: 0.5 },
      }),
    ).toBe('drop-notice');
    // Without a baseline the room cannot pretend to know who spoke.
    expect(
      shouldIgnoreTranscript({
        baselineHz: null,
        heardHz: 220,
        confidence: 0.95,
        ownerOnly: false,
        tuning: { requireOwnerVoice: true },
      }),
    ).toBe('answer');
  });
});
