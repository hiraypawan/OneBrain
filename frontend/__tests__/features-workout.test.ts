import { describe, it, expect } from 'vitest';
import {
  detectWorkoutIntent, presetById, customPreset, buildCues, PRESETS, formatClock,
} from '../lib/workout';

describe('detectWorkoutIntent', () => {
  it('detects presets', () => {
    expect(detectWorkoutIntent('7 minute workout shuru karo')).toEqual({ kind: 'preset', id: 'seven-minute' });
    expect(detectWorkoutIntent('tabata karo')).toEqual({ kind: 'preset', id: 'tabata' });
  });
  it('detects custom timers', () => {
    expect(detectWorkoutIntent('30 sec on 10 off 8 rounds')).toEqual({ kind: 'custom', workSec: 30, restSec: 10, rounds: 8 });
  });
  it('detects controls', () => {
    expect(detectWorkoutIntent('pause workout')).toEqual({ kind: 'control', action: 'pause' });
    expect(detectWorkoutIntent('resume workout')).toEqual({ kind: 'control', action: 'resume' });
    expect(detectWorkoutIntent('stop workout')).toEqual({ kind: 'control', action: 'stop' });
  });
  it('ignores unrelated text', () => {
    expect(detectWorkoutIntent('20 pushups kar liye')).toBeNull();
    expect(detectWorkoutIntent('stop')).toBeNull();
  });
});

describe('presets and cues', () => {
  it('ships solid presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(presetById('seven-minute')?.rounds).toHaveLength(12);
  });
  it('rejects absurd customs', () => {
    expect(customPreset(30, 10, 31)).toBeNull();
    expect(customPreset(900, 10, 5)).toBeNull();
    expect(customPreset(30, 10, 8)?.rounds).toHaveLength(8);
  });
  it('builds ordered cues with countdowns and a done cue', () => {
    const s = buildCues(presetById('tabata')!);
    expect(s.totalSec).toBe(8 * 20 + 7 * 10);
    expect(s.cues[0].kind).toBe('start');
    expect(s.cues[s.cues.length - 1].kind).toBe('done');
    const ats = s.cues.map((c) => c.atSec);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(s.cues.some((c) => c.kind === 'countdown')).toBe(true);
  });
  it('formats the clock', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(9)).toBe('0:09');
  });
});
