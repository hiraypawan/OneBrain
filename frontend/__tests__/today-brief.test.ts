import { describe, expect, it } from 'vitest';
import { briefFacts, briefLine, dateLine, greetingFor } from '@/lib/today-brief';
import type { TodayStrip } from '@/lib/track';
import type { TodoCounts } from '@/lib/todo';

const counts = (over: Partial<TodoCounts> = {}): TodoCounts => ({
  open: 0, dueToday: 0, overdue: 0, done: 0, byOrigin: { device: 0, reminder: 0, server: 0 }, ...over,
});
const strip = (over: Partial<TodayStrip> = {}): TodayStrip => ({
  spend: 0, kcal: 0, workouts: 0, water: 0, streak: 0, entries: 0, ...over,
});
const goals = { kcalGoal: 2200, budget: 0, budgetCurrency: 'INR' };

describe('greeting and date', () => {
  it('does not call 3am "good evening"', () => {
    expect(greetingFor(new Date(2026, 8, 17, 3, 30))).toBe('Still awake?');
    expect(greetingFor(new Date(2026, 8, 17, 8, 0))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 8, 17, 14, 0))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 8, 17, 21, 0))).toBe('Good evening');
  });
  it('names the weekday and day without a year', () => {
    expect(dateLine(new Date(2026, 8, 17))).toMatch(/Thursday/);
    expect(dateLine(new Date(2026, 8, 17))).toContain('17');
    expect(dateLine(new Date(2026, 8, 17))).not.toMatch(/2026/);
  });
});

describe('briefFacts', () => {
  it('stays silent when nothing is true', () => {
    expect(briefFacts({ counts: counts(), strip: strip(), goals, items: 0 })).toEqual([]);
  });
  it('reports open things with a due-today qualifier', () => {
    const facts = briefFacts({ counts: counts({ open: 3, dueToday: 2, overdue: 1 }), strip: strip(), goals, items: 5 });
    const tasks = facts.find(f => f.id === 'tasks')!;
    expect(tasks.value).toBe('3 things');
    expect(tasks.note).toBe('2 to today, 1 overdue');
    expect(tasks.href).toBe('/control?panel=tasks');
  });
  it('links a spent amount to today in the expenses lens', () => {
    const facts = briefFacts({ counts: counts(), strip: strip({ spend: 250, entries: 1 }), goals, items: 0 }, new Date(2026, 8, 17));
    const money = facts.find(f => f.id === 'money')!;
    expect(money.value).toContain('250');
    expect(money.href).toMatch(/^\/track\?lens=expenses&range=day&day=2026-09-17$/);
    expect(money.note).toBeUndefined(); // no limit set → no invented budget line
  });
  it('names the month limit as a month, not as today', () => {
    const facts = briefFacts({
      counts: counts(),
      strip: strip({ spend: 400, entries: 2, budget: { set: true, limit: 8000, spent: 4210, remaining: 3790, pct: 0.53, status: 'ok', daysLeft: 13, projected: 8400, line: '₹4,210 of ₹8,000 · 53% used', paceLine: 'pace' } }),
      goals: { ...goals, budget: 8000 },
      items: 2,
    });
    expect(facts.find(f => f.id === 'money')!.note).toBe('of ₹8,000 this month');
  });
  it('labels a calorie estimate as approximate against the goal', () => {
    const facts = briefFacts({ counts: counts(), strip: strip({ kcal: 1450 }), goals, items: 1 });
    const food = facts.find(f => f.id === 'food')!;
    expect(food.value).toBe('≈1450 kcal');
    expect(food.note).toBe('of about 2200');
    expect(food.href).toContain('lens=food');
  });
  it('counts a streak as movement even on a rest day', () => {
    const facts = briefFacts({ counts: counts(), strip: strip({ workouts: 0, streak: 5 }), goals, items: 1 });
    const w = facts.find(f => f.id === 'workouts')!;
    expect(w.value).toBe('Nothing today');
    expect(w.note).toBe('5-day streak');
  });
  it('skips sleep until it was actually logged', () => {
    expect(briefFacts({ counts: counts(), strip: strip(), goals, items: 1 }).some(f => f.id === 'sleep')).toBe(false);
    const withSleep = briefFacts({ counts: counts(), strip: strip({ sleep: 7.5 }), goals, items: 1 });
    expect(withSleep.find(f => f.id === 'sleep')!.value).toBe('7.5 h');
  });
  it('says so plainly when there is nothing to brief', () => {
    expect(briefLine({ counts: counts(), strip: strip(), goals, items: 0 }, 'whatever the model said'))
      .toMatch(/Nothing saved yet/);
    expect(briefLine({ counts: counts({ open: 1 }), strip: strip(), goals, items: 2 }, 'Two notes, one task.'))
      .toBe('Two notes, one task.');
  });
});
