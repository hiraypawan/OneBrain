import { describe, it, expect } from 'vitest';
import {
  parseFitnessLog, resolveAmbiguous, dayTotals, computeStreaks,
  recoveryLine, detectLogRepair, dayKey, type FitnessLog,
} from '../lib/fitness';

const log = (over: Partial<FitnessLog> = {}): FitnessLog => ({
  id: Math.random().toString(), kind: 'workout', label: 'x', createdAt: Date.now(), source: 'voice', ...over,
});

describe('parseFitnessLog', () => {
  it('parses counted exercises in English and Hinglish', () => {
    expect(parseFitnessLog('20 pushups kar liye')).toMatchObject({ status: 'ok', log: { kind: 'workout', qty: 20 } });
    expect(parseFitnessLog('bees pushups kar liye')).toMatchObject({ status: 'ok', log: { kind: 'workout', qty: 20 } });
    expect(parseFitnessLog('50 baithak ho gayi')).toMatchObject({ status: 'ok', log: { kind: 'workout', qty: 50 } });
  });
  it('parses cardio and gym', () => {
    expect(parseFitnessLog('ran 5 km')).toMatchObject({ status: 'ok', log: { kind: 'workout', unit: 'km', qty: 5 } });
    expect(parseFitnessLog('gym gaya 1 ghanta')).toMatchObject({ status: 'ok', log: { kind: 'workout' } });
    expect(parseFitnessLog('30 min yoga')).toMatchObject({ status: 'ok', log: { kind: 'workout', qty: 30 } });
  });
  it('parses food with estimates', () => {
    const r = parseFitnessLog('2 roti khayi');
    expect(r).toMatchObject({ status: 'ok', log: { kind: 'food', qty: 2, calories: 140 } });
  });
  it('parses expenses with words and symbols', () => {
    expect(parseFitnessLog('kharcha 200 chai')).toMatchObject({ status: 'ok', log: { kind: 'expense', amount: 200 } });
    expect(parseFitnessLog('kharcha do sau chai')).toMatchObject({ status: 'ok', log: { kind: 'expense', amount: 200 } });
  });
  it('parses sleep, energy, water, weight', () => {
    expect(parseFitnessLog('6 ghante soya')).toMatchObject({ status: 'ok', log: { kind: 'sleep', qty: 6 } });
    expect(parseFitnessLog('energy low hai aaj')).toMatchObject({ status: 'ok', log: { kind: 'energy' } });
    expect(parseFitnessLog('3 glass pani piya')).toMatchObject({ status: 'ok', log: { kind: 'water', qty: 3 } });
    expect(parseFitnessLog('weight 70 kg')).toMatchObject({ status: 'ok', log: { kind: 'weight', qty: 70 } });
  });
  it('flags bare numbers as ambiguous', () => {
    const r = parseFitnessLog('200');
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.value).toBe(200);
  });
  it('returns none for unrelated text', () => {
    expect(parseFitnessLog('mausam kaisa hai')).toMatchObject({ status: 'none' });
  });
});

describe('resolveAmbiguous', () => {
  it('resolves one-word answers', () => {
    expect(resolveAmbiguous(200, 'pushups')).toMatchObject({ status: 'ok', log: { kind: 'workout', qty: 200 } });
    expect(resolveAmbiguous(200, 'rupaye kharcha')).toMatchObject({ status: 'ok', log: { kind: 'expense', amount: 200 } });
    expect(resolveAmbiguous(3, 'paani')).toMatchObject({ status: 'ok', log: { kind: 'water' } });
    expect(resolveAmbiguous(200, 'huh?')).toMatchObject({ status: 'none' });
  });
});

describe('totals and streaks', () => {
  it('computes day totals', () => {
    const now = Date.now();
    const t = dayTotals([
      log({ kind: 'workout', label: '20 Pushups', createdAt: now }),
      log({ kind: 'food', label: 'Roti', calories: 140, createdAt: now }),
      log({ kind: 'expense', label: 'x', amount: 200, createdAt: now }),
    ], dayKey(now));
    expect(t.workoutCount).toBe(1);
    expect(t.foodCalories).toBe(140);
    expect(t.spend).toBe(200);
  });
  it('computes streaks across days', () => {
    const day = 86400000;
    const now = Date.now();
    const s = computeStreaks([
      log({ createdAt: now }),
      log({ createdAt: now - day }),
      log({ createdAt: now - 2 * day }),
      log({ createdAt: now - 5 * day }),
    ], now);
    expect(s.logDays).toBe(3);
    expect(s.workoutDays).toBe(3);
  });
});

describe('recoveryLine', () => {
  it('calls rest on short sleep', () => {
    expect(recoveryLine({ sleepHrs: 4, workoutsLast3Days: 0 })).toMatch(/light day/);
  });
  it('greenlights good sleep', () => {
    expect(recoveryLine({ sleepHrs: 8, energy: 'high', workoutsLast3Days: 1 })).toMatch(/green light/);
  });
});

describe('detectLogRepair', () => {
  it('detects repair commands', () => {
    expect(detectLogRepair('change last log to 60')).toBe(60);
    expect(detectLogRepair('galat hai, last wala saath kar do')).toBe(7);
    expect(detectLogRepair('20 pushups')).toBeNull();
  });
});
