// Track: four lenses (Expenses · Food · Health · Workouts) over the ONE
// `fitnessLogs` store the voice logger already fills. Nothing here writes or
// invents data — every number is aggregated from logs the user actually made,
// and food figures keep their "≈" label. Pure + unit-tested, so the UI stays a
// thin, dumb renderer.

import {
  computeStreaks,
  dayKey,
  type FitnessLog,
  type Streaks,
} from './fitness';

export type TrackLens = 'expenses' | 'food' | 'health' | 'workouts';
export type TrackRangeKind = 'day' | 'week' | 'month';

export const TRACK_LENSES: {
  id: TrackLens;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { id: 'expenses', label: 'Expenses', icon: '💸', blurb: 'What left your pocket, and where it went' },
  { id: 'food', label: 'Food diary', icon: '🍛', blurb: 'Meals and rough calories against your goal' },
  { id: 'health', label: 'Health', icon: '😴', blurb: 'Sleep, water, weight and energy trends' },
  { id: 'workouts', label: 'Workouts', icon: '💪', blurb: 'Sessions, volume and streaks' },
];

const DAY = 86400000;

// ---------------------------------------------------------------- ranges ----

export interface TrackRange {
  kind: TrackRangeKind;
  /** Inclusive ms. */
  start: number;
  /** Exclusive ms. */
  end: number;
  /** "Today", "Mon 14 – Sun 20 September", "September 2026". */
  label: string;
  /** Short label for the same thing, used in export names and headings. */
  short: string;
  /** Day keys covered by the range (oldest → newest). */
  days: string[];
  /** The anchor day key the range was derived from. */
  anchor: string;
  isCurrent: boolean;
}

function parseKey(key: string | undefined, now: Date): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return now;
}

function atZero(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function mondayOf(d: Date): Date {
  const c = atZero(d);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
}

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const fmtShortDay = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(d);

function dayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const today = atZero(new Date());
  if (key === dayKey(today.getTime(), today)) return 'Today';
  if (key === dayKey(today.getTime() - DAY, today)) return 'Yesterday';
  return fmtDay(date);
}

/** Compact label for a chart tick: weekday for a day/week window, day-of-month
 *  for a month (30 weekday names would be unreadable). */
export function tickLabel(key: string, kind: TrackRangeKind): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  if (kind === 'month') return String(d || 1);
  return fmtShortDay(date);
}

function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(d);
}

/** Resolve a day/week/month window from an anchor day key ("2026-09-16"). */
export function rangeFor(
  kind: TrackRangeKind,
  anchorKey?: string,
  now = new Date(),
): TrackRange {
  const safeKind: TrackRangeKind =
    kind === 'week' || kind === 'month' ? kind : 'day';
  const anchor = parseKey(anchorKey, now);
  const todayKey = dayKey(now.getTime(), now);
  let start: Date;
  let end: Date;
  let label: string;
  let short: string;
  if (safeKind === 'day') {
    start = atZero(anchor);
    end = new Date(start.getTime() + DAY);
    const isToday = dayKey(start.getTime(), start) === todayKey;
    label = isToday ? 'Today' : dayLabel(dayKey(start.getTime(), start));
    short = isToday ? 'today' : dayKey(start.getTime(), start);
  } else if (safeKind === 'week') {
    start = mondayOf(anchor);
    // A week that contains today stops at tomorrow's zero (partial week).
    const naturalEnd = new Date(start.getTime() + 7 * DAY);
    const todayZero = atZero(now);
    const endRaw = naturalEnd.getTime() > todayZero.getTime() + DAY
      ? new Date(todayZero.getTime() + DAY)
      : naturalEnd;
    end = endRaw;
    const last = new Date(endRaw.getTime() - DAY);
    label = `${fmtDay(start)} – ${fmtDay(last)}`;
    short = `${dayKey(start.getTime(), start)}..${dayKey(last.getTime(), last)}`;
  } else {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const naturalEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    const todayZero = atZero(now);
    const endRaw =
      naturalEnd.getTime() > todayZero.getTime() + DAY
        ? new Date(todayZero.getTime() + DAY)
        : naturalEnd;
    end = endRaw;
    label = monthLabel(anchor);
    short = `${anchor.getFullYear()}-${`${anchor.getMonth() + 1}`.padStart(2, '0')}`;
  }
  const days: string[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += DAY)
    days.push(dayKey(t, new Date(t)));
  const anchorIsNow = dayKey(anchor.getTime(), anchor) === todayKey;
  return {
    kind: safeKind,
    start: start.getTime(),
    end: end.getTime(),
    label,
    short,
    days,
    anchor: dayKey(start.getTime(), start),
    isCurrent: safeKind === 'day' ? anchorIsNow : days.includes(todayKey),
  };
}

/** Move an anchor key by `delta` windows (−1 = previous, +1 = next). */
export function shiftAnchor(kind: TrackRangeKind, anchorKey: string, delta: number): string {
  const [y, m, d] = anchorKey.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  if (kind === 'day') base.setDate(base.getDate() + delta);
  else if (kind === 'week') base.setDate(base.getDate() + 7 * delta);
  else base.setMonth(base.getMonth() + delta);
  return dayKey(base.getTime(), base);
}

export function inRange(log: FitnessLog, range: TrackRange): boolean {
  return log.createdAt >= range.start && log.createdAt < range.end;
}

const logsIn = (logs: FitnessLog[], range: TrackRange) =>
  (logs || [])
    .filter((l) => inRange(l, range))
    .sort((a, b) => b.createdAt - a.createdAt);

// ---------------------------------------------------------------- money ----

export function money(amount: number, currency = 'INR'): string {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency === 'INR' ? '₹' : '$'}${Math.round(value)}`;
  }
}

/** Money for headings and voice lines: grouped, no false precision. */
export function plainMoney(amount: number, currency = 'INR'): string {
  const sym = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : `${currency} `;
  const n = Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
  const digits = n % 1 === 0 ? 0 : 2;
  let body: string;
  try {
    body = n.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  } catch {
    body = n.toFixed(digits);
  }
  return `${sym}${body}`;
}

// ------------------------------------------------------------ categories ----

export interface ExpenseCategory {
  id: string;
  label: string;
  emoji: string;
  re: RegExp;
}

/** Keyword buckets, Hindi/Hinglish-aware, in match order. First hit wins, so
 *  specific categories (medicines) come before broad ones (shopping). */
export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 'food', label: 'Food & drink', emoji: '🍛', re: /chai|tea|coffee|snack|lunch|dinner|breakfast|nashta|khana|khaana|roti|thali|dosa|samosa|maggi|pizza|burger|biryani|zomato|swiggy|eatery|cafe|restaurant|dabba|canteen|sweet|mithai|juice|cold drink|cola|beer|wine/i },
  { id: 'groceries', label: 'Groceries', emoji: '🛒', re: /sabzi|vegetable|fruit|phal|doodh|milk|atta|maida|dal|daal|grocery|groceries|kirana|kiran|general store|supermarket|market se|rice|chawal|oil|tel|masala|paneer|egg|anda|bread|biscuit/i },
  { id: 'travel', label: 'Travel', emoji: '🚌', re: /bus|auto|rickshaw|cab|ola|uber(?! eat)|metro|train|fuel|petrol|diesel|cng|parking|toll|flight|airport|travel|(train|bus|metro|train|rail|movie)?\s*(?:journey )?ticket\s*(?:ke?|for)?\s*(bus|train|metro|flight|travel)|booked (?:a )?(?:ticket|fare)/i },
  { id: 'bills', label: 'Bills & rent', emoji: '🧾', re: /bill|bijli|electricity|current bill|recharge|internet|wifi|broadband|gas\b|pipri|rent|house rent|emi|installment|subscription|netflix|spotify|prime|insurance|premium|tax|fee|tuition/i },
  { id: 'health', label: 'Health', emoji: '💊', re: /medicine|dawai|doctor|clinic|hospital|pharmacy|medical|checkup|test\b|lab\b|gym|protein|supplement|vitamin|illness|fever/i },
  { id: 'fun', label: 'Fun & outings', emoji: '🎬', re: /movie|film|cinema|show|concert|party|game|gaming|outing|trip|vacation|holiday|drink|club|bowling/i },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️', re: /shirt|pant|shoes|kapde|clothes|dress|amazon|flipkart|myntra|buy|bought|purchase|gift|toothpaste|soap|shampoo|phone|charger|earphone/i },
  { id: 'family', label: 'Family & giving', emoji: '🤝', re: /maa|mummy|papa|beta|bhai|didi|gift to|shagun|donation|daan|temple|mandir|help/i },
  { id: 'other', label: 'Other', emoji: '📦', re: /.^/ },
];

export function classifyExpense(text: string): ExpenseCategory {
  const haystack = String(text || '').toLowerCase();
  for (const c of EXPENSE_CATEGORIES) {
    if (c.id === 'other') continue;
    if (c.re.test(haystack)) return c;
  }
  return EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

export function expenseAmount(l: FitnessLog): number {
  const v = l.amount ?? l.qty ?? 0;
  return Number.isFinite(v) ? v : 0;
}

export interface CategoryTotal {
  id: string;
  label: string;
  emoji: string;
  total: number;
  count: number;
  share: number; // 0..1
}

export interface SeriesPoint {
  key: string;
  label: string;
  value: number;
}

export interface ExpenseView {
  items: FitnessLog[];
  count: number;
  total: number;
  currency: string;
  byCategory: CategoryTotal[];
  series: SeriesPoint[];
  largest?: { log: FitnessLog; amount: number; category: ExpenseCategory };
  perDayAvg: number;
  activeDays: number;
  busiest?: SeriesPoint;
}

/** Everything about spending in one range: per-item list, category totals,
 *  a per-day bar series and the single largest expense. */
export function expenseView(logs: FitnessLog[], range: TrackRange): ExpenseView {
  const items = logsIn(logs, range).filter((l) => l.kind === 'expense');
  const totals = new Map<string, { total: number; count: number }>();
  const perDay = new Map<string, number>();
  let total = 0;
  let largest: ExpenseView['largest'];
  for (const l of items) {
    const amount = expenseAmount(l);
    total += amount;
    const cat = classifyExpense(`${l.label} ${l.detail || ''}`);
    const row = totals.get(cat.id) || { total: 0, count: 0 };
    row.total += amount;
    row.count += 1;
    totals.set(cat.id, row);
    const k = dayKey(l.createdAt);
    perDay.set(k, (perDay.get(k) || 0) + amount);
    if (!largest || amount > largest.amount) largest = { log: l, amount, category: cat };
  }
  const byCategory: CategoryTotal[] = [...totals.entries()]
    .map(([id, v]) => {
      const meta = EXPENSE_CATEGORIES.find((c) => c.id === id)!;
      return { id, label: meta.label, emoji: meta.emoji, total: v.total, count: v.count, share: total ? v.total / total : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const series: SeriesPoint[] = range.days.map((key) => ({
    key,
    label: dayLabel(key),
    value: Math.round((perDay.get(key) || 0) * 100) / 100,
  }));
  const activeDays = [...perDay.values()].filter((v) => v > 0).length;
  const busiest = series.reduce<SeriesPoint | undefined>(
    (best, p) => (p.value > 0 && (!best || p.value > best.value) ? p : best),
    undefined,
  );
  const currency = items[0]?.currency || 'INR';
  return {
    items,
    count: items.length,
    total: Math.round(total * 100) / 100,
    currency,
    byCategory,
    series,
    largest,
    perDayAvg: range.days.length ? Math.round((total / range.days.length) * 100) / 100 : 0,
    activeDays,
    busiest,
  };
}

// ------------------------------------------------------------- budgeting ----

export interface BudgetState {
  set: boolean;
  limit: number;
  spent: number;
  remaining: number;
  pct: number; // 0..∞ (share of limit used)
  status: 'ok' | 'watch' | 'over';
  /** Days left in the month, from the range's anchor day. */
  daysLeft: number;
  /** What a same-pace month would look like. */
  projected: number;
  line: string; // "₹4,210 of ₹8,000 · 53% used"
  paceLine: string; // plain-language read, honest about partial months
}

/** Monthly budget pressure. `monthDays`/`dayOfMonth` come from the calendar,
 *  so a half-finished month is described as one — never annualised wrongly. */
export function budgetStatus(input: {
  spent: number;
  limit: number;
  monthDays: number;
  dayOfMonth: number;
  currency?: string;
}): BudgetState {
  const { spent, limit, monthDays, dayOfMonth } = input;
  const currency = input.currency || 'INR';
  const remaining = Math.round((limit - spent) * 100) / 100;
  const pct = limit > 0 ? spent / limit : 0;
  const elapsed = Math.max(1, Math.min(monthDays, dayOfMonth));
  const projected = Math.round((spent / elapsed) * monthDays);
  const set = Number.isFinite(limit) && limit > 0;
  const daysLeft = Math.max(0, monthDays - dayOfMonth);
  let status: BudgetState['status'] = 'ok';
  if (set && spent > limit) status = 'over';
  else if (set && pct >= 0.8) status = 'watch';
  const line = set
    ? `${plainMoney(spent, currency)} of ${plainMoney(limit, currency)} · ${Math.round(pct * 100)}% used`
    : `${plainMoney(spent, currency)} spent · no monthly limit set`;
  const paceLine = !set
    ? 'Set a monthly limit to see how the pace compares.'
    : status === 'over'
      ? `Over by ${plainMoney(Math.abs(remaining), currency)} with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.`
      : `At this pace the month lands near ${plainMoney(projected, currency)}.${
          daysLeft > 0 ? ` ${plainMoney(Math.max(0, remaining) / daysLeft, currency)} a day keeps you inside.` : ''
        }`
  return {
    set,
    limit,
    spent: Math.round(spent * 100) / 100,
    remaining,
    pct,
    status,
    daysLeft,
    projected,
    line,
    paceLine,
  };
}

/** The single bar the user asked for: "₹X of ₹Y". */
export function budgetBar(state: BudgetState): {
  text: string;
  pct: number;
  over: boolean;
  tone: 'ok' | 'watch' | 'over';
} {
  return {
    text: state.set
      ? `${plainMoney(state.spent)} of ${plainMoney(state.limit)}`
      : plainMoney(state.spent),
    pct: Math.min(100, Math.round(state.pct * 100)),
    over: state.set && state.spent > state.limit,
    tone: state.status,
  };
}

// ------------------------------------------------------------------ food ----

export type MealSlot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';

export function mealSlot(ts: number): MealSlot {
  const h = new Date(ts).getHours();
  if (h < 11) return 'Breakfast';
  if (h < 16) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Snacks';
}

export const MEAL_ORDER: MealSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

export interface FoodDayView {
  key: string;
  label: string;
  items: FitnessLog[];
  meals: { slot: MealSlot; items: FitnessLog[]; kcal: number }[];
  totalKcal: number;
  estimated: number;
  goal: number;
  remaining: number;
  over: boolean;
  loggedLine: string;
}

/** Day-by-day food diary for a range. Estimates stay labeled ≈ — the log
 *  carries an approximation, not a lab result. */
export function foodView(
  logs: FitnessLog[],
  range: TrackRange,
  goal: number,
): FoodDayView[] {
  const all = logsIn(logs, range).filter((l) => l.kind === 'food');
  const byDay = new Map<string, FitnessLog[]>();
  for (const l of all) {
    const k = dayKey(l.createdAt);
    const list = byDay.get(k) || [];
    list.push(l);
    byDay.set(k, list);
  }
  // Ranges with no food still render (honest "nothing logged" days).
  const keys = range.kind === 'day' ? [dayKey(range.start)] : range.days.filter((k) => byDay.has(k));
  return keys.map((key) => {
    const items = (byDay.get(key) || []).sort((a, b) => b.createdAt - a.createdAt);
    const meals = MEAL_ORDER.map((slot) => {
      const list = items.filter((l) => mealSlot(l.createdAt) === slot);
      return { slot, items: list, kcal: list.reduce((s, l) => s + (l.calories || 0), 0) };
    }).filter((m) => m.items.length);
    const totalKcal = items.reduce((s, l) => s + (l.calories || 0), 0);
    const estimated = items.filter((l) => l.calories).length;
    return {
      key,
      label: dayLabel(key),
      items,
      meals,
      totalKcal,
      estimated,
      goal,
      remaining: goal - totalKcal,
      over: goal > 0 && totalKcal > goal,
      loggedLine: items.length
        ? `${items.length} item${items.length === 1 ? '' : 's'}${estimated ? ` · ${estimated} with ≈ calories` : ''}`
        : 'nothing logged',
    };
  });
}

export interface FoodSummary {
  totalKcal: number;
  itemCount: number;
  daysWithData: number;
  goal: number;
  goalDays: number;
  overDays: number;
  avgPerDay: number;
  topLabel?: string;
  topCount: number;
}

export function foodSummary(days: FoodDayView[]): FoodSummary {
  const all = days.flatMap((d) => d.items);
  const counts = new Map<string, number>();
  for (const l of all) {
    const key = l.label.replace(/^\d+\s*/, '').trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let topLabel: string | undefined;
  let topCount = 0;
  for (const [label, n] of counts) {
    if (n > topCount) {
      topCount = n;
      topLabel = label;
    }
  }
  const withData = days.filter((d) => d.items.length);
  const totalKcal = withData.reduce((s, d) => s + d.totalKcal, 0);
  return {
    totalKcal,
    itemCount: all.length,
    daysWithData: withData.length,
    goal: withData[0]?.goal ?? 0,
    goalDays: withData.filter((d) => d.goal > 0 && d.totalKcal > 0 && d.totalKcal <= d.goal).length,
    overDays: withData.filter((d) => d.over).length,
    avgPerDay: withData.length ? Math.round(totalKcal / withData.length) : 0,
    topLabel,
    topCount,
  };
}

// ---------------------------------------------------------------- health ----

export interface MetricPoint {
  key: string;
  label: string;
  value: number;
  note?: string;
}

export interface HealthView {
  sleep: MetricPoint[];
  water: MetricPoint[];
  weight: MetricPoint[];
  energy: { key: string; label: string; value: 'high' | 'medium' | 'low' }[];
  avgSleep?: number;
  bestSleep?: MetricPoint;
  latestWeight?: MetricPoint;
  weightChange?: number;
  avgWater?: number;
  sleepGoal: number;
  waterGoal: number;
  sleepGoalDays: number;
  waterGoalDays: number;
  daysWithData: number;
  insight: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function valueByDay(logs: FitnessLog[], kind: FitnessLog['kind'], days: string[], pick: 'sum' | 'last'): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (l.kind !== kind || l.qty === undefined) continue;
    const key = dayKey(l.createdAt);
    if (!days.includes(key)) continue;
    const prev = out.get(key);
    if (pick === 'last') out.set(key, l.qty);
    else out.set(key, (prev || 0) + l.qty);
  }
  return out;
}

export function healthView(
  logs: FitnessLog[],
  range: TrackRange,
  goals: { sleep: number; water: number },
): HealthView {
  const scoped = logsIn(logs, range);
  const sleepMap = valueByDay(scoped, 'sleep', range.days, 'sum');
  const waterMap = valueByDay(scoped, 'water', range.days, 'sum');
  const weightMap = valueByDay(scoped, 'weight', range.days, 'last');
  const sleep: MetricPoint[] = [];
  const water: MetricPoint[] = [];
  const weight: MetricPoint[] = [];
  const energy: HealthView['energy'] = [];
  for (const key of range.days) {
    const d = parseKey(key, new Date());
    const label = fmtShortDay(d);
    if (sleepMap.has(key)) sleep.push({ key, label, value: round1(sleepMap.get(key)!) });
    const w = waterMap.get(key);
    if (w) water.push({ key, label, value: round1(w), note: w >= goals.water ? 'goal met' : undefined });
    if (weightMap.has(key)) weight.push({ key, label, value: weightMap.get(key)! });
    const e = [...scoped]
      .reverse()
      .find((l) => l.kind === 'energy' && dayKey(l.createdAt) === key && l.detail);
    if (e?.detail)
      energy.push({ key, label, value: e.detail === 'high' || e.detail === 'low' ? e.detail : 'medium' });
  }
  const avg = (arr: MetricPoint[]) =>
    arr.length ? round1(arr.reduce((s, p) => s + p.value, 0) / arr.length) : undefined;
  const avgSleep = avg(sleep);
  const avgWater = avg(water);
  const bestSleep = sleep.reduce<MetricPoint | undefined>((b, p) => (!b || p.value > b.value ? p : b), undefined);
  const latestWeight = weight[weight.length - 1];
  const firstWeight = weight[0];
  const sleepGoalDays = sleep.filter((p) => p.value >= goals.sleep).length;
  const waterGoalDays = water.filter((p) => p.value >= goals.water).length;
  const daysWithData = range.days.filter(
    (k) => sleepMap.has(k) || waterMap.has(k) || weightMap.has(k),
  ).length;
  const lowDays = energy.filter((e) => e.value === 'low').length;
  const insight = !daysWithData
    ? 'Nothing logged in this stretch yet. Say “6 ghante soya”, “8 glass paani” or “weight 72” and the bars fill in.'
    : avgSleep !== undefined && avgSleep < 6.5
      ? `You averaged ${avgSleep}h of sleep — under 6.5h. Late screens are the usual cause; try moving the phone out of the bedroom tonight.`
      : avgSleep !== undefined
        ? `Sleep averaged ${avgSleep}h across ${sleep.length} logged night${sleep.length === 1 ? '' : 's'}. ${sleepGoalDays} of them hit your ${goals.sleep}h goal.`
        : weight.length > 1
          ? `Weight moved ${round1(weight[weight.length - 1].value - weight[0].value)} kg across ${weight.length} logs.`
          : lowDays
            ? `${lowDays} low-energy day${lowDays === 1 ? '' : 's'} in this window — worth pairing with your sleep bars before blaming the workout.`
            : `Logged on ${daysWithData} day${daysWithData === 1 ? '' : 's'} in this window.`;
  return {
    sleep,
    water,
    weight,
    energy,
    avgSleep,
    bestSleep,
    latestWeight,
    weightChange: latestWeight && firstWeight && latestWeight !== firstWeight
      ? round1(latestWeight.value - firstWeight.value)
      : undefined,
    avgWater,
    sleepGoal: goals.sleep,
    waterGoal: goals.water,
    sleepGoalDays,
    waterGoalDays,
    daysWithData,
    insight,
  };
}

// --------------------------------------------------------------- workouts ----

export interface WorkoutDay {
  key: string;
  label: string;
  items: FitnessLog[];
  count: number;
  summaryLine: string;
}

export interface TypeTotal {
  label: string;
  count: number;
  total: number;
  unit: string;
}

export interface WorkoutView {
  days: WorkoutDay[];
  sessions: number;
  activeDays: number;
  streaks: Streaks;
  byType: TypeTotal[];
  volumeLine: string;
  bestDay?: WorkoutDay;
  lastSession?: FitnessLog;
}

const labelFamily = (label: string): { key: string; unit: string } => {
  const l = String(label || '').toLowerCase();
  const has = (re: RegExp) => re.test(l);
  if (has(/pushup|dand/)) return { key: 'Pushups', unit: 'reps' };
  if (has(/pullup|chinup/)) return { key: 'Pullups', unit: 'reps' };
  if (has(/squat|baithak/)) return { key: 'Squats', unit: 'reps' };
  if (has(/situp|crunch/)) return { key: 'Situps', unit: 'reps' };
  if (has(/lunge/)) return { key: 'Lunges', unit: 'reps' };
  if (has(/burpee/)) return { key: 'Burpees', unit: 'reps' };
  if (has(/plank/)) return { key: 'Plank', unit: 'sec' };
  if (has(/skip|rope|rassi/)) return { key: 'Skipping', unit: 'mins' };
  if (has(/run|daud/)) return { key: 'Run', unit: 'km' };
  if (has(/walk|chal/)) return { key: 'Walk', unit: 'km' };
  if (has(/cycle/)) return { key: 'Cycling', unit: 'km' };
  if (has(/swim/)) return { key: 'Swim', unit: 'km' };
  if (has(/yoga/)) return { key: 'Yoga', unit: 'mins' };
  if (has(/gym|workout|kasrat/)) return { key: 'Gym / workout', unit: 'mins' };
  if (has(/surya/)) return { key: 'Surya Namaskar', unit: 'rounds' };
  return { key: 'Other', unit: '' };
};

const qtyOf = (l: FitnessLog) => (Number.isFinite(l.qty as number) ? (l.qty as number) : 0);

export function workoutView(logs: FitnessLog[], range: TrackRange): WorkoutView {
  const scoped = logsIn(logs, range).filter((l) => l.kind === 'workout');
  const byDay = new Map<string, FitnessLog[]>();
  for (const l of scoped) {
    const k = dayKey(l.createdAt);
    const list = byDay.get(k) || [];
    list.push(l);
    byDay.set(k, list);
  }
  const days: WorkoutDay[] = range.days
    .filter((k) => byDay.has(k))
    .map((key) => {
      const items = byDay.get(key)!.sort((a, b) => b.createdAt - a.createdAt);
      return {
        key,
        label: dayLabel(key),
        items,
        count: items.length,
        summaryLine: items.map((l) => l.label).join(' · '),
      };
    });
  const totals = new Map<string, TypeTotal>();
  for (const l of scoped) {
    const { key, unit } = labelFamily(l.label);
    const row = totals.get(key) || { label: key, count: 0, total: 0, unit };
    row.count += 1;
    row.total += qtyOf(l);
    totals.set(key, row);
  }
  const byType = [...totals.values()].sort((a, b) => b.count - a.count || b.total - a.total);
  const bestDay = days.reduce<WorkoutDay | undefined>(
    (b, d) => (!b || d.count > b.count ? d : b),
    undefined,
  );
  const volumeLine = byType.length
    ? byType
        .slice(0, 4)
        .map((t) => `${t.count} × ${t.label}${t.unit && t.total ? ` (${Math.round(t.total)}${t.unit})` : ''}`)
        .join(' · ')
    : 'No sessions logged in this window.';
  return {
    days,
    sessions: scoped.length,
    activeDays: days.length,
    streaks: computeStreaks(logs || []),
    byType,
    volumeLine,
    bestDay,
    lastSession: scoped[0],
  };
}

// ------------------------------------------------------------------ bars ----

/** Percentage height for a bar chart, capped so one outlier cannot flatten
 *  every other day. `max` falls back to the largest value. */
export function barPct(value: number, max?: number): number {
  const m = max && max > 0 ? max : 0;
  if (!m || !Number.isFinite(value) || value <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / m) * 100)));
}

export function seriesMax(points: { value: number }[]): number {
  return points.reduce((m, p) => (p.value > m ? p.value : m), 0);
}

// ------------------------------------------------------------- exporting ----

/** CSV for the whole log (Fitness panel and Track both call this one
 *  function, so an export from either place is the same file). */
export function fitnessCsv(logs: FitnessLog[]): string {
  const rows = ['day,time,kind,label,qty,unit,calories,amount,currency,category'];
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  for (const l of [...(logs || [])].sort((a, b) => a.createdAt - b.createdAt)) {
    const d = new Date(l.createdAt);
    rows.push(
      [
        dayKey(l.createdAt),
        d.toLocaleTimeString('en-IN'),
        l.kind,
        esc(l.label),
        l.qty ?? '',
        l.unit ?? '',
        l.calories ?? '',
        l.amount ?? '',
        l.currency ?? '',
        l.kind === 'expense' ? esc(classifyExpense(`${l.label} ${l.detail || ''}`).label) : '',
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function csvName(prefix: string, range: TrackRange): string {
  return `onebrain-${prefix}-${range.short.replace(/\.\./g, '_')}.csv`;
}

// ------------------------------------------------------------ deep links ----

export function trackHref(opts: {
  lens: TrackLens;
  range?: TrackRangeKind;
  day?: string;
}): string {
  const params = new URLSearchParams();
  params.set('lens', opts.lens);
  if (opts.range) params.set('range', opts.range);
  if (opts.day) params.set('day', opts.day);
  return `/track?${params.toString()}`;
}

export function isTrackLens(value: string | null | undefined): value is TrackLens {
  return !!value && TRACK_LENSES.some((l) => l.id === value);
}

export function isRangeKind(value: string | null | undefined): value is TrackRangeKind {
  return value === 'day' || value === 'week' || value === 'month';
}

// --------------------------------------------------- voice: Track commands ----

export type TrackCommand =
  | { action: 'set-budget'; amount: number; currency: string }
  | { action: 'budget-status' }
  | { action: 'todo-status' }
  | { action: 'open'; lens: TrackLens; range: TrackRangeKind };

const LENS_WORDS: [RegExp, TrackLens][] = [
  [/(expense|kharcha|kharch|spend|spending|paisa|money|budget)/i, 'expenses'],
  [/(food|khana|meal|diet|calorie|kcal)/i, 'food'],
  [/(sleep|neend|water|paani|weight|vazan|health|energy|fitness)/i, 'health'],
  [/(workout|exercise|kasrat|gym|pushup|training|streak)/i, 'workouts'],
];

const RANGE_WORDS: [RegExp, TrackRangeKind][] = [
  [/(this week|is hafte|iss hafte|week)/i, 'week'],
  [/(this month|is mahine|month|mahina)/i, 'month'],
  [/(today|aaj|day)/i, 'day'],
];

/**
 * Voice commands about the Track tab itself: set/read the monthly budget, or
 * open a view. Deliberately narrow — a plain "kharcha 200 chai" is a LOG, not
 * a command, and the log path still owns it. Pure + tested.
 */
export function parseTrackCommand(text: string, logs?: FitnessLog[], now = new Date()): TrackCommand | null {
  const t = normalizeText(text);
  if (!t) return null;
  const budgetSet = t.match(
    /^(?:set|make|rakh do|rakh|update|badal|change)(?:\s+my)?(?:\s+(?:monthly|month))?(?:\s+budget)?\s*(?:budget|limit)\s*(?:to|ko|ka|mein|me|=)?\s*(?:₹|\$|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/,
  ) || t.match(/^(?:monthly\s+)?budget\s*(?:ko|to|=)?\s*(?:₹|\$|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:karo|kar do|rakh do|set karo|record)?$/);
  const amount = budgetSet ? Number(String(budgetSet[1]).replace(/,/g, '')) : NaN;
  if (budgetSet && Number.isFinite(amount) && amount > 0 && amount <= 100000000) {
    return { action: 'set-budget', amount, currency: currencyOf(t) };
  }
  if (/(budget|limit|kitna bacha|bacha hai)/.test(t) && /(mera|my|kya|how much|kitna|left|bache|status|set)/.test(t)) {
    return { action: 'budget-status' };
  }
  // "How much have I still got to do?" reads the same unified list the To-Do
  // panel shows, so the answer and the screen can never disagree.
  const wantsTheList =
    /\b(todo|to-do|tasks?|kaam|list|pending)\b/.test(t) &&
    /(how many|kitne|kitna|show|open|batao|dikhao|kya|what|left|bacha|pending)/.test(t);
  const aboutThePast = /(yesterday|kal|pichh|last (week|month|year)|ago|before|pehle)\b/.test(t);
  if (wantsTheList && !aboutThePast) {
    return { action: 'todo-status' };
  }
  const wantsOpen = /^(open|show|kholo|dikhao|launch)\b/.test(t) || /\b(track)\b/.test(t);
  if (!wantsOpen) return null;
  if (!/(track|report|hisab|summary|lens|view)/.test(t) && !LENS_WORDS.some(([re]) => re.test(t))) return null;
  let lens: TrackLens = 'expenses';
  for (const [re, id] of LENS_WORDS) {
    if (re.test(t)) { lens = id; break; }
  }
  let range: TrackRangeKind = logs && logs.length ? 'week' : 'month';
  for (const [re, id] of RANGE_WORDS) {
    if (re.test(t)) { range = id; break; }
  }
  if (/\b(today|aaj)\b/.test(t)) range = 'day';
  void now;
  return { action: 'open', lens, range };
}

function normalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    // Keep "20,000" intact: only punctuation that is not inside a number.
    .replace(/[?!;:]+/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function currencyOf(t: string): string {
  if (/\$|\bdollar\b|usd/.test(t)) return 'USD';
  if (/€|euro/.test(t)) return 'EUR';
  return 'INR';
}

// ------------------------------------------------------ Today-strip helper ----

export interface TodayStrip {
  spend: number;
  kcal: number;
  workouts: number;
  water: number;
  sleep?: number;
  streak: number;
  entries: number;
  budget?: BudgetState;
}

/** Compact "today so far" numbers for the Today brief rail. */
export function todayStrip(
  logs: FitnessLog[],
  goals: { kcalGoal: number; budget: number; budgetCurrency?: string },
  now = new Date(),
): TodayStrip {
  const key = dayKey(now.getTime(), now);
  const today = (logs || []).filter((l) => dayKey(l.createdAt) === key);
  const spend = today
    .filter((l) => l.kind === 'expense')
    .reduce((s, l) => s + expenseAmount(l), 0);
  const month = rangeFor('month', key, now);
  const monthSpend = (logs || [])
    .filter((l) => l.kind === 'expense' && inRange(l, month))
    .reduce((s, l) => s + expenseAmount(l), 0);
  return {
    spend: Math.round(spend * 100) / 100,
    kcal: today.reduce((s, l) => s + (l.kind === 'food' ? l.calories || 0 : 0), 0),
    workouts: today.filter((l) => l.kind === 'workout').length,
    water: today.reduce((s, l) => s + (l.kind === 'water' ? (l.unit === 'L' ? (l.qty || 0) * 4 : l.qty || 0) : 0), 0),
    sleep: [...today].reverse().find((l) => l.kind === 'sleep' && l.qty)?.qty,
    streak: computeStreaks(logs || []).logDays,
    entries: today.length,
    budget: budgetStatus({
      spent: monthSpend,
      limit: goals.budget || 0,
      monthDays: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
      dayOfMonth: now.getDate(),
      currency: goals.budgetCurrency || 'INR',
    }),
  };
}
