import { describe, expect, it } from 'vitest';
import {
  classifyEnvironment,
  effectiveEndOfSpeechMs,
  environmentChanged,
  environmentTuning,
  ownerRequiredHere,
  resetNoiseFloor,
  rmsOf,
  updateNoiseFloor,
  ENVIRONMENT_TUNING,
} from '../lib/environment';

describe('environment recognition', () => {
  it('measures frame energy', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf([0, 0, 0])).toBe(0);
    expect(rmsOf([0.5, -0.5])).toBeCloseTo(0.5, 5);
  });

  it('classifies rooms by their sustained noise floor', () => {
    expect(classifyEnvironment(0.0005)).toBe('quiet');
    expect(classifyEnvironment(0.0039)).toBe('quiet');
    expect(classifyEnvironment(0.005)).toBe('home');
    expect(classifyEnvironment(0.02)).toBe('noisy');
    expect(classifyEnvironment(0.06)).toBe('loud');
    expect(classifyEnvironment(0.5)).toBe('loud');
    // Bad input must never crash the listening loop...
    expect(classifyEnvironment(Number.NaN)).toBe('quiet');
    // ...and a negative reading is treated as silence, not as noise.
    expect(classifyEnvironment(-1)).toBe('quiet');
  });

  it('waits longer for a turn to end as the room gets louder', () => {
    const waits = (['quiet', 'home', 'noisy', 'loud'] as const).map((env) => environmentTuning(env).endOfSpeechMs);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(new Set(waits).size).toBe(4);
  });

  it('adapts the user\'s own wait to the room, inside the accepted band', () => {
    const user = 1600;
    expect(effectiveEndOfSpeechMs(user, environmentTuning('quiet'))).toBe(960);
    expect(effectiveEndOfSpeechMs(user, environmentTuning('home'))).toBe(1360);
    expect(effectiveEndOfSpeechMs(user, environmentTuning('noisy'))).toBe(1920);
    expect(effectiveEndOfSpeechMs(user, environmentTuning('loud'))).toBe(2400);
    // Never below/above what the setting itself allows, and never NaN.
    expect(effectiveEndOfSpeechMs(700, environmentTuning('quiet'))).toBe(700);
    expect(effectiveEndOfSpeechMs(4000, environmentTuning('loud'))).toBe(4000);
    expect(effectiveEndOfSpeechMs(undefined, environmentTuning('home'))).toBe(1360);
    expect(effectiveEndOfSpeechMs('nonsense', environmentTuning('home'))).toBe(1360);
  });

  it('asks for more confidence and a closer voice match in noise', () => {
    expect(environmentTuning('quiet').minConfidence).toBeLessThan(environmentTuning('noisy').minConfidence);
    expect(environmentTuning('loud').ownerTolerance).toBeLessThan(environmentTuning('quiet').ownerTolerance);
    expect(environmentTuning('loud').requireOwnerVoice).toBe(true);
    expect(environmentTuning('quiet').requireOwnerVoice).toBe(false);
    for (const tuning of Object.values(ENVIRONMENT_TUNING)) {
      expect(tuning.label.length).toBeGreaterThan(0);
      expect(tuning.advice.length).toBeGreaterThan(0);
      expect(tuning.holdMs).toBeGreaterThan(0);
    }
  });

  it('rises fast and falls slowly, and adopts the first readings', () => {
    let state = resetNoiseFloor();
    // First readings are averaged, not adopted raw.
    state = updateNoiseFloor(state, 0.001);
    expect(state.floor).toBeCloseTo(0.001, 6);
    state = updateNoiseFloor(state, 0.001);
    state = updateNoiseFloor(state, 0.001);
    for (let i = 0; i < 5; i += 1) state = updateNoiseFloor(state, 0.08);
    const loud = state.floor!;
    expect(loud).toBeGreaterThan(0.03); // one second of noise is believed
    for (let i = 0; i < 5; i += 1) state = updateNoiseFloor(state, 0.0005);
    expect(state.floor!).toBeGreaterThan(0.01); // a quiet gap is not a quiet room
    expect(state.floor!).toBeLessThan(loud);
  });

  it('reports a class change only when the class really changed', () => {
    expect(environmentChanged(null, 'quiet')).toBe(true);
    expect(environmentChanged('quiet', 'quiet')).toBe(false);
    expect(environmentChanged('home', 'loud')).toBe(true);
  });

  it('only enforces the owner-voice rule when a baseline exists', () => {
    const loud = environmentTuning('loud');
    expect(ownerRequiredHere(loud, 140, false)).toBe(true);
    expect(ownerRequiredHere(loud, null, false)).toBe(false);
    // Explicit strict mode still needs something to compare against.
    expect(ownerRequiredHere(environmentTuning('quiet'), 140, true)).toBe(true);
    expect(ownerRequiredHere(environmentTuning('quiet'), null, true)).toBe(false);
    // A quiet room never enforces owner-only on its own.
    expect(ownerRequiredHere(environmentTuning('quiet'), 140, false)).toBe(false);
  });
});
