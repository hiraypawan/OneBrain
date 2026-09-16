import { describe, expect, it } from 'vitest';
import {
  barPct,
  budgetBar,
  budgetStatus,
  classifyExpense,
  csvName,
  expenseView,
  fitnessCsv,
  foodSummary,
  foodView,
  healthView,
  inRange,
  mealSlot,
  parseTrackCommand,
  plainMoney,
  rangeFor,
  seriesMax,
  shiftAnchor,
  tickLabel,
  todayStrip,
  trackHref,
  workoutView,
} from '@/lib/track';
import { dayKey, type FitnessLog } from '@/lib/fitness';

const DAY = 86400000;

/** Fixed anchor so date math is deterministic regardless of run day. */
const ANCHOR = '2026-09-16'; // a Wednesday
const anchorDate = new Date(2026, 8, 16, 12, 0, 0);

function log(over: Partial<FitnessLog> = {}): FitnessLog {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'expense',
    label: 'x',
    createdAt: anchorDate.getTime(),
    source: 'voice',
    ...over,
  };
}

function at(dayOffset: number, hour = 9): number {
  const d = new Date(anchorDate);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

describe('Track ranges', () => {
  it('builds a day window from an anchor key', () => {
    const r = rangeFor('day', ANCHOR, anchorDate);
    expect(r.days).toEqual([ANCHOR]);
    expect(r.label).toBe('Today');
    expect(r.end - r.start).toBe(DAY);
    expect(r.isCurrent).toBe(true);
  });
  it('builds a Monday-anchored week that stops after today', () => {
    const r = rangeFor('week', ANCHOR, anchorDate);
    expect(r.days[0]).toBe('2026-09-14'); // Monday
    expect(r.days).toHaveLength(3); // Mon, Tue, Wed — the week is only part-run
    expect(r.isCurrent).toBe(true);
  });
  it('walks whole weeks when the anchor is in the past', () => {
    const r = rangeFor('week', '2026-09-07', anchorDate);
    expect(r.days).toHaveLength(7);
    expect(r.isCurrent).toBe(false);
    expect(r.label).toContain('–');
  });
  it('caps a running month at today and keeps 7-day windows for a week shift', () => {
    const month = rangeFor('month', ANCHOR, anchorDate);
    expect(month.days[0]).toBe('2026-09-01');
    expect(month.days[month.days.length - 1]).toBe(ANCHOR);
    expect(month.label).toBe('September 2026');
    expect(shiftAnchor('week', ANCHOR, -1)).toBe('2026-09-09');
    expect(shiftAnchor('month', ANCHOR, -1)).toBe('2026-08-16');
    expect(shiftAnchor('day', ANCHOR, 1)).toBe('2026-09-17');
  });
  it('never accepts a bogus anchor or range', () => {
    const r = rangeFor('nonsense' as never, 'yesterday', anchorDate);
    expect(r.kind).toBe('day');
    expect(r.days[0]).toBe(dayKey(anchorDate.getTime(), anchorDate));
  });
  it('filters logs by the half-open window', () => {
    const r = rangeFor('day', ANCHOR, anchorDate);
    expect(inRange(log({ createdAt: r.start }), r)).toBe(true);
    expect(inRange(log({ createdAt: r.end - 1 }), r)).toBe(true);
    expect(inRange(log({ createdAt: r.end }), r)).toBe(false);
  });
  it('labels ticks by weekday for short windows and by day for a month', () => {
    expect(tickLabel(ANCHOR, 'week')).toMatch(/Wed/);
    expect(tickLabel('2026-09-26', 'month')).toBe('26');
  });
});

describe('expense categories', () => {
  it('reads Hinglish and English alike', () => {
    expect(classifyExpense('Spent ₹40 — chai at the stall').id).toBe('food');
    expect(classifyExpense('kharcha 200 — bus ticket').id).toBe('travel');
    expect(classifyExpense('Spent ₹600 — sabzi le li').id).toBe('groceries');
    expect(classifyExpense('bijli bill 1,200').id).toBe('bills');
    expect(classifyExpense('dawai 250').id).toBe('health');
    expect(classifyExpense('movie ticket 300').id).toBe('fun');
    expect(classifyExpense('amazon shoes 2400').id).toBe('shopping');
  });
  it('never invents a category for an unlabelled expense', () => {
    expect(classifyExpense('Spent ₹200').id).toBe('other');
    expect(classifyExpense('').id).toBe('other');
  });
});

describe('expenseView', () => {
  const logs = [
    log({ label: 'Spent ₹40 — chai', amount: 40, currency: 'INR', createdAt: at(0, 8) }),
    log({ label: 'Spent ₹1200 — bijli bill', amount: 1200, currency: 'INR', createdAt: at(-1, 20) }),
    log({ label: 'Spent ₹250 — dawai', amount: 250, currency: 'INR', createdAt: at(-1, 12) }),
    log({ label: 'Spent ₹90 — samosa', amount: 90, currency: 'INR', createdAt: at(-6, 17) }),
    log({ kind: 'food', label: '2 roti', calories: 140, createdAt: at(0, 13) }),
  ];
  it('totals only expenses inside the window, newest first', () => {
    const week = rangeFor('week', ANCHOR, anchorDate);
    const view = expenseView(logs, week);
    expect(view.items.map((l) => l.amount)).toEqual([40, 1200, 250]);
    expect(view.total).toBe(1490);
    expect(view.currency).toBe('INR');
  });
  it('splits by category with honest shares', () => {
    const view = expenseView(logs, rangeFor('month', ANCHOR, anchorDate));
    const bills = view.byCategory.find((c) => c.id === 'bills');
    expect(bills?.total).toBe(1200);
    expect(Math.round((bills?.share || 0) * 100)).toBe(76);
    expect(view.byCategory[0].total).toBeGreaterThanOrEqual(view.byCategory[1].total);
    expect(view.byCategory.reduce((s, c) => s + c.count, 0)).toBe(4);
  });
  it('shows a per-day bar series including zero days', () => {
    const day = expenseView(logs, rangeFor('day', ANCHOR, anchorDate));
    expect(day.series).toHaveLength(1);
    expect(day.series[0].value).toBe(40);
    const week = expenseView(logs, rangeFor('week', ANCHOR, anchorDate));
    expect(week.series.map((p) => p.value)).toEqual([0, 1450, 40]);
    expect(week.activeDays).toBe(2);
    expect(week.busiest?.value).toBe(1450);
  });
  it('names the largest single expense and the daily average', () => {
    const view = expenseView(logs, rangeFor('week', ANCHOR, anchorDate));
    expect(view.largest?.amount).toBe(1200);
    expect(view.largest?.category.id).toBe('bills');
    expect(view.perDayAvg).toBe(Math.round((1490 / 3) * 100) / 100);
  });
  it('is empty but honest when nothing was logged', () => {
    const view = expenseView([], rangeFor('day', ANCHOR, anchorDate));
    expect(view.total).toBe(0);
    expect(view.items).toEqual([]);
    expect(view.byCategory).toEqual([]);
    expect(view.largest).toBeUndefined();
  });
});

describe('monthly budget', () => {
  it('says "₹X of ₹Y" and clamps the bar at 100%', () => {
    const state = budgetStatus({ spent: 4210, limit: 8000, monthDays: 30, dayOfMonth: 16 });
    const bar = budgetBar(state);
    expect(bar.text).toBe('₹4,210 of ₹8,000');
    expect(bar.pct).toBe(53);
    expect(bar.over).toBe(false);
    expect(state.status).toBe('ok');
  });
  it('warns at 80% and reports over-spend with days left', () => {
    expect(budgetBar(budgetStatus({ spent: 6600, limit: 8000, monthDays: 30, dayOfMonth: 26 })).tone).toBe('watch');
    const over = budgetStatus({ spent: 9000, limit: 8000, monthDays: 30, dayOfMonth: 30 });
    expect(over.status).toBe('over');
    expect(over.daysLeft).toBe(0);
    expect(over.paceLine).toContain('Over by');
  });
  it('projects the month from the days actually run, and never claims a limit that was not set', () => {
    const state = budgetStatus({ spent: 1000, limit: 0, monthDays: 30, dayOfMonth: 10 });
    expect(state.set).toBe(false);
    expect(state.line).toContain('no monthly limit set');
    const paced = budgetStatus({ spent: 1000, limit: 5000, monthDays: 30, dayOfMonth: 10 });
    expect(paced.projected).toBe(3000);
    expect(paced.paceLine).toContain('₹200'); // ₹4,000 left across 20 remaining days
  });
  it('formats money without a decimal for whole amounts', () => {
    expect(plainMoney(1234.5)).toBe('₹1,234.50');
    expect(plainMoney(0)).toBe('₹0');
    expect(plainMoney(20, 'USD')).toBe('$20');
  });
});

describe('food diary', () => {
  it('buckets by the hour of logging', () => {
    expect(mealSlot(new Date(2026, 8, 16, 7, 30).getTime())).toBe('Breakfast');
    expect(mealSlot(new Date(2026, 8, 16, 13).getTime())).toBe('Lunch');
    expect(mealSlot(new Date(2026, 8, 16, 19).getTime())).toBe('Dinner');
    expect(mealSlot(new Date(2026, 8, 16, 23).getTime())).toBe('Snacks');
  });
  it('groups meals per day against the goal, keeping the ≈ label honest', () => {
    const logs = [
      log({ kind: 'food', label: 'Chai', calories: 60, createdAt: at(0, 7) }),
      log({ kind: 'food', label: '2 Roti', calories: 140, createdAt: at(0, 13) }),
      log({ kind: 'food', label: 'Meal logged', createdAt: at(0, 20) }),
      log({ kind: 'food', label: 'Old', calories: 500, createdAt: at(-20, 13) }),
    ];
    const days = foodView(logs, rangeFor('day', ANCHOR, anchorDate), 2200);
    expect(days).toHaveLength(1);
    const day = days[0];
    expect(day.totalKcal).toBe(200);
    expect(day.meals.map((m) => m.slot)).toEqual(['Breakfast', 'Lunch', 'Dinner']);
    expect(day.remaining).toBe(2000);
    expect(day.over).toBe(false);
    expect(day.items.find((l) => l.label === 'Meal logged')?.calories).toBeUndefined();
  });
  it('summarizes a range: only days with food count against the goal', () => {
    const logs = [
      log({ kind: 'food', label: 'Thali', calories: 700, createdAt: at(0, 13) }),
      log({ kind: 'food', label: 'Thali', calories: 2500, createdAt: at(-1, 13) }),
    ];
    const days = foodView(logs, rangeFor('week', ANCHOR, anchorDate), 2200);
    const summary = foodSummary(days);
    expect(summary.itemCount).toBe(2);
    expect(summary.totalKcal).toBe(3200);
    expect(summary.daysWithData).toBe(2);
    expect(summary.overDays).toBe(1);
    expect(summary.goalDays).toBe(1);
    expect(summary.avgPerDay).toBe(1600);
    expect(summary.topLabel).toBe('Thali');
    expect(summary.topCount).toBe(2);
  });
  it('renders an empty day inside a day range instead of hiding it', () => {
    const days = foodView([], rangeFor('day', ANCHOR, anchorDate), 2000);
    expect(days).toHaveLength(1);
    expect(days[0].items).toEqual([]);
    expect(days[0].loggedLine).toBe('nothing logged');
  });
});

describe('health trends', () => {
  const logs = [
    log({ kind: 'sleep', label: 'Slept 6 hrs', qty: 6, unit: 'hrs', createdAt: at(0, 7) }),
    log({ kind: 'sleep', label: 'Slept 8 hrs', qty: 8, unit: 'hrs', createdAt: at(-1, 7) }),
    log({ kind: 'water', label: 'Water 5 glass', qty: 5, unit: 'glass', createdAt: at(0, 15) }),
    log({ kind: 'water', label: 'Water 3 glass', qty: 3, unit: 'glass', createdAt: at(0, 18) }),
    log({ kind: 'weight', label: 'Weight 72 kg', qty: 72, unit: 'kg', createdAt: at(-2, 7) }),
    log({ kind: 'weight', label: 'Weight 71.5 kg', qty: 71.5, unit: 'kg', createdAt: at(0, 7) }),
    log({ kind: 'energy', label: 'Energy low', detail: 'low', createdAt: at(-1, 11) }),
    log({ kind: 'expense', label: 'Spent ₹40', amount: 40, createdAt: at(0, 8) }),
  ];
  it('averages sleep, sums water per day, keeps last weight, counts goals met', () => {
    const health = healthView(logs, rangeFor('week', ANCHOR, anchorDate), { sleep: 7, water: 8 });
    expect(health.sleep.map((p) => p.value)).toEqual([8, 6]);
    expect(health.avgSleep).toBe(7);
    expect(health.water[health.water.length - 1].value).toBe(8);
    expect(health.waterGoalDays).toBe(1);
    expect(health.latestWeight?.value).toBe(71.5);
    expect(health.weightChange).toBe(-0.5);
    expect(health.energy[0].value).toBe('low');
    expect(health.insight).toContain('7h');
  });
  it('says so when nothing is logged, instead of showing zeros', () => {
    const health = healthView([], rangeFor('week', ANCHOR, anchorDate), { sleep: 7, water: 8 });
    expect(health.avgSleep).toBeUndefined();
    expect(health.daysWithData).toBe(0);
    expect(health.insight).toContain('Nothing logged');
  });
});

describe('workouts', () => {
  const logs = [
    log({ kind: 'workout', label: '20 Pushups', qty: 20, unit: 'reps', createdAt: at(0, 7) }),
    log({ kind: 'workout', label: '30 Pushups', qty: 30, unit: 'reps', createdAt: at(0, 19) }),
    log({ kind: 'workout', label: 'Walk 3 km', qty: 3, unit: 'km', createdAt: at(-1, 7) }),
    log({ kind: 'workout', label: 'Gym 45 min', qty: 45, unit: 'mins', createdAt: at(-1, 18) }),
    log({ kind: 'food', label: 'Dal', calories: 150, createdAt: at(0, 13) }),
  ];
  it('groups by day, folds labels into families and totals volume', () => {
    const view = workoutView(logs, rangeFor('week', ANCHOR, anchorDate));
    expect(view.sessions).toBe(4);
    expect(view.activeDays).toBe(2);
    expect(view.days[0].count).toBe(2);
    const pushups = view.byType.find((t) => t.label === 'Pushups');
    expect(pushups).toMatchObject({ count: 2, total: 50, unit: 'reps' });
    expect(view.volumeLine).toContain('2 × Pushups (50reps)');
    expect(view.lastSession?.label).toBe('30 Pushups');
    expect(view.bestDay?.count).toBe(2);
  });
  it('surfaces the streaks that were already being computed', () => {
    const view = workoutView(logs, rangeFor('week', ANCHOR, anchorDate));
    expect(view.streaks.workoutDays).toBeGreaterThanOrEqual(0);
    expect(typeof view.streaks.logDays).toBe('number');
  });
  it('is honest about an empty window', () => {
    const view = workoutView([], rangeFor('day', ANCHOR, anchorDate));
    expect(view.days).toEqual([]);
    expect(view.volumeLine).toBe('No sessions logged in this window.');
  });
});

describe('bars, CSV and deep links', () => {
  it('scales bars against the max without letting one outlier flatten the rest', () => {
    expect(barPct(50, 100)).toBe(50);
    expect(barPct(0, 100)).toBe(0);
    expect(barPct(120, 100)).toBe(100);
    expect(barPct(10, 0)).toBe(0);
    expect(seriesMax([{ value: 2 }, { value: 9 }, { value: 4 }])).toBe(9);
  });
  it('exports one row per log, quote-escaping labels, with a category for expenses', () => {
    const csv = fitnessCsv([
      log({ label: 'Spent ₹40 — "chai"', amount: 40, detail: 'chai', createdAt: at(0, 8) }),
      log({ kind: 'food', label: '2 roti', calories: 140, createdAt: at(0, 13) }),
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('day,time,kind,label,qty,unit,calories,amount,currency,category');
    expect(lines[1]).toContain('"Spent ₹40 — ""chai"""');
    expect(lines[1]).toContain('Food & drink');
    expect(lines).toHaveLength(3);
    expect(csvName('expenses', rangeFor('week', ANCHOR, anchorDate))).toMatch(/^onebrain-expenses-2026-09-14_2026-09-16\.csv$/);
  });
  it('builds a deep link a voice answer can hand to the browser', () => {
    expect(trackHref({ lens: 'expenses', range: 'week', day: ANCHOR })).toBe('/track?lens=expenses&range=week&day=2026-09-16');
    expect(trackHref({ lens: 'food' })).toBe('/track?lens=food');
  });
  it('summarizes today for the Today rail without inventing a budget', () => {
    const strip = todayStrip(
      [
        log({ label: 'Spent ₹40', amount: 40, createdAt: Date.now() }),
        log({ kind: 'food', label: 'Chai', calories: 60, createdAt: Date.now() }),
        log({ kind: 'workout', label: '20 Pushups', qty: 20, unit: 'reps', createdAt: Date.now() }),
        log({ kind: 'water', label: 'Water 2 L', qty: 2, unit: 'L', createdAt: Date.now() }),
      ],
      { kcalGoal: 2200, budget: 0 },
    );
    expect(strip).toMatchObject({ spend: 40, kcal: 60, workouts: 1, water: 8, entries: 4 });
    expect(strip.budget?.set).toBe(false);
  });
});

describe('parseTrackCommand (voice control of the tab)', () => {
  it('reads a budget from English and Hinglish phrasings', () => {
    expect(parseTrackCommand('set my monthly budget to 20,000')).toEqual({ action: 'set-budget', amount: 20000, currency: 'INR' });
    expect(parseTrackCommand('budget 15000 rakh do')).toMatchObject({ action: 'set-budget', amount: 15000 });
    expect(parseTrackCommand('set budget $500')).toMatchObject({ action: 'set-budget', amount: 500, currency: 'USD' });
  });
  it('answers a budget question without touching the log parser', () => {
    expect(parseTrackCommand('what is my budget this month')).toEqual({ action: 'budget-status' });
    expect(parseTrackCommand('mera budget kya hai')).toEqual({ action: 'budget-status' });
  });
  it('opens the lens the words point at', () => {
    expect(parseTrackCommand('open track')).toMatchObject({ action: 'open', lens: 'expenses' });
    expect(parseTrackCommand('show my food diary this month')).toMatchObject({ action: 'open', lens: 'food', range: 'month' });
    expect(parseTrackCommand('dikhao meri health report')).toMatchObject({ action: 'open', lens: 'health' });
    expect(parseTrackCommand('show my workouts today')).toMatchObject({ action: 'open', lens: 'workouts', range: 'day' });
  });
  it('answers a “what is left to do” question from the unified list', () => {
    expect(parseTrackCommand('show my open tasks')).toEqual({ action: 'todo-status' });
    expect(parseTrackCommand('how many tasks are pending')).toEqual({ action: 'todo-status' });
    expect(parseTrackCommand('mere kaam kitne bache hain')).toEqual({ action: 'todo-status' });
  });
  it('leaves plain logging and questions alone', () => {
    expect(parseTrackCommand('kharcha 200 chai')).toBeNull();
    expect(parseTrackCommand('I spent 200 on chai')).toBeNull();
    expect(parseTrackCommand('what expenses did I do yesterday')).toBeNull();
    expect(parseTrackCommand('20 pushups kar liye')).toBeNull();
    expect(parseTrackCommand('explain how a budget works in a startup')).toBeNull();
    // A question about yesterday belongs to the recall path, not the To-Do list.
    expect(parseTrackCommand('what tasks did I save yesterday')).toBeNull();
    expect(parseTrackCommand('')).toBeNull();
  });
});
