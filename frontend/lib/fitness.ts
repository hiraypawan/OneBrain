// Voice fitness + food + expense + sleep/energy logging.
// "20 pushups kar liye" / "2 roti khayi" / "kharcha 200 chai" / "6 ghante soya".
// Pure parsers + totals + streaks + recovery advice. Calorie figures are rough
// home-style estimates and are ALWAYS labeled as such — never medical advice.

import { findNumber } from './numbers';
import {
  hasDoneWord,
  hasLogVerb,
  hasPhrase,
  hasWord,
  isPlanOrRequest,
  isQuestion,
  mentionsMeasureUnit,
  stripWords,
} from './intent-guard';

export type FitnessKind = 'workout' | 'food' | 'expense' | 'sleep' | 'energy' | 'water' | 'weight';

export interface FitnessLog {
  id: string;
  kind: FitnessKind;
  label: string;
  qty?: number;
  unit?: string;
  detail?: string;
  calories?: number;
  amount?: number;
  currency?: string;
  createdAt: number;
  source: 'voice' | 'typed' | 'workout';
}

export type ParseResult =
  | { status: 'ok'; log: Omit<FitnessLog, 'id' | 'createdAt' | 'source'> }
  | { status: 'ambiguous'; value: number; candidates: string[]; raw: string }
  | { status: 'none' };

const EXERCISES: { re: RegExp; label: string; unit: string }[] = [
  // Every pattern is whole-word bounded: an unbounded `plank` also matched
  // "plankton" and `push[\s-]?up` matched inside longer words.
  { re: /\bpush[\s-]?ups?\b|\bdand\b|\bdund\b/, label: 'Pushups', unit: 'reps' },
  { re: /\bpull[\s-]?ups?\b|\bchin[\s-]?ups?\b/, label: 'Pullups', unit: 'reps' },
  { re: /\bbaithak\b|\bbaithakein\b|\bsquats?\b|\buthak\b/, label: 'Squats', unit: 'reps' },
  { re: /\bsit[\s-]?ups?\b|\bcrunch(es)?\b/, label: 'Situps', unit: 'reps' },
  { re: /\blunges?\b/, label: 'Lunges', unit: 'reps' },
  { re: /\bburpees?\b/, label: 'Burpees', unit: 'reps' },
  { re: /\bjumping jacks?\b/, label: 'Jumping jacks', unit: 'reps' },
  { re: /\bplanks?\b/, label: 'Plank', unit: 'sec' },
  { re: /\bsurya ?namaskar\b|\bsuryanamaskar\b/, label: 'Surya Namaskar', unit: 'rounds' },
  { re: /\bskipping\b|\bjump ?rope\b|\brassi\b/, label: 'Skipping', unit: 'mins' },
];

// Rough home-style estimates (kcal). Labeled approximate everywhere shown.
// Whole-word bounded for the same reason: unbounded `tea` matched "instead" and
// "team", `rice` matched "price", `anda` matched "standard", `kela` matched
// "kerala", `dosa` matched "dosage" (audit finding I1).
const FOODS: { re: RegExp; label: string; kcal: number; unit: string }[] = [
  { re: /\broti\b|\brotis\b|\brotiya?n?\b|\bchapati(s)?\b|\bphulka(s)?\b|\bphulke\b/, label: 'Roti', kcal: 70, unit: 'pc' },
  { re: /\bparath(as?|e|as)\b|\bparanth(as?|e)\b/, label: 'Paratha', kcal: 180, unit: 'pc' },
  { re: /\brajma (chawal|rice)\b/, label: 'Rajma chawal', kcal: 450, unit: 'plate' },
  { re: /\bchole (bhature|chawal|rice)\b|\bchana\b/, label: 'Chole', kcal: 400, unit: 'plate' },
  { re: /\bdal\b|\bdaal\b/, label: 'Dal', kcal: 150, unit: 'bowl' },
  { re: /\brice\b|\bchawal\b|\bbhaat\b/, label: 'Rice', kcal: 200, unit: 'bowl' },
  { re: /\bkhichdi\b|\bkhichadi\b/, label: 'Khichdi', kcal: 300, unit: 'bowl' },
  { re: /\bsamosa(s)?\b/, label: 'Samosa', kcal: 250, unit: 'pc' },
  { re: /\bpakora(s)?\b|\bpakoda(s)?\b|\bbhaji(ya)?\b/, label: 'Pakora', kcal: 200, unit: 'plate' },
  { re: /\bchai\b|\btea\b/, label: 'Chai', kcal: 60, unit: 'cup' },
  { re: /\bcoffee\b/, label: 'Coffee', kcal: 50, unit: 'cup' },
  { re: /\bmilk\b|\bdoodh\b|\bdudh\b/, label: 'Milk', kcal: 120, unit: 'glass' },
  { re: /\bbanana(s)?\b|\bkela(s)?\b|\bkele\b/, label: 'Banana', kcal: 105, unit: 'pc' },
  { re: /\bapple(s)?\b|\bseb\b/, label: 'Apple', kcal: 95, unit: 'pc' },
  { re: /\beggs?\b|\banda\b|\bande\b|\bomelette(s)?\b/, label: 'Eggs', kcal: 80, unit: 'pc' },
  { re: /\bpaneer\b/, label: 'Paneer dish', kcal: 250, unit: 'bowl' },
  { re: /\bchicken\b/, label: 'Chicken', kcal: 300, unit: 'serving' },
  { re: /\bmaggi\b|\bnoodles\b/, label: 'Noodles', kcal: 350, unit: 'pack' },
  { re: /\bdosa(s)?\b|\bdosay\b|\bdosam\b/, label: 'Dosa', kcal: 170, unit: 'pc' },
  { re: /\bidli(s)?\b/, label: 'Idli', kcal: 60, unit: 'pc' },
  { re: /\bpoha\b/, label: 'Poha', kcal: 250, unit: 'plate' },
  { re: /\bupma\b|\buppuma\b/, label: 'Upma', kcal: 250, unit: 'plate' },
  { re: /\bsandwich(es)?\b/, label: 'Sandwich', kcal: 250, unit: 'pc' },
  { re: /\bpizza(s)?\b/, label: 'Pizza', kcal: 550, unit: 'serving' },
  { re: /\bburger(s)?\b/, label: 'Burger', kcal: 500, unit: 'pc' },
  { re: /\bthali\b/, label: 'Thali', kcal: 700, unit: 'thali' },
  { re: /\bsalad(s)?\b/, label: 'Salad', kcal: 100, unit: 'bowl' },
  { re: /\bcurd\b|\bdahi\b|\byogurt\b|\byoghurt\b|\braita\b/, label: 'Curd', kcal: 100, unit: 'bowl' },
  { re: /\blunch\b|\bkhana\b|\bkhane\b/, label: 'Lunch', kcal: 500, unit: 'meal' },
  { re: /\bdinner\b/, label: 'Dinner', kcal: 500, unit: 'meal' },
  { re: /\bbreakfast\b|\bnashta\b|\bnaashta\b/, label: 'Breakfast', kcal: 300, unit: 'meal' },
];

// Money words that make an amount an expense. "diya/gaya/lag" alone are too
// weak without an amount and a currency-free unit check, so they sit in the
// same list and are gated by `mentionsMeasureUnit` below.
// Strong money context only. Bare Hindi verbs like `diya`/`gaya`/`lag` are far
// too common — "50 baithak ho gayi" logged a ₹50 expense — so they appear only
// inside the phrases below, where the money sense is unambiguous.
const MONEY_WORDS = [
  'kharcha', 'kharach', 'kharch', 'spent', 'spend', 'paid', 'payment', 'rupay',
  'rupaye', 'rupee', 'rupees', 'rs', 'inr', 'paisa', 'paise', 'bill',
];
const MONEY_PHRASES = [
  'lag gaye', 'lag gaya', 'lag gayi', 'payment kiya', 'paise diya', 'paise diye',
  'rupay diya', 'rupay diye', 'kharcha kiya', 'kharch kiya', 'kharcha hua', 'kharch hua',
  'bill aaya',
];

function hasMoneyContext(lower: string): boolean {
  return hasWord(lower, ...MONEY_WORDS) || hasPhrase(lower, ...MONEY_PHRASES);
}

function moneyAmount(t: string): { amount: number; currency: string } | null {
  const withSymbol = t.match(/(₹\s*|\brs\.?\s*|\binr\s*|\$\s*|\busd\s*|€\s*|\beur\s*)(\d[\d,]*(?:\.\d+)?)/i);
  if (withSymbol) {
    const amount = Number(withSymbol[2].replace(/,/g, ''));
    if (!Number.isFinite(amount)) return null;
    const sym = withSymbol[1];
    return {
      amount,
      currency: /\$|usd/i.test(sym) ? 'USD' : /€|eur/i.test(sym) ? 'EUR' : 'INR',
    };
  }
  return null;
}

/**
 * Turn a sentence that REPORTS something into a log row.
 *
 * Three gates, in order, because any one of them alone still misfires:
 *  1. sentence type — a question or a plan is never a log ("what is the date
 *     today", "let us do 20 pushups");
 *  2. whole words — `ate` must not fire inside "date"/"create"/"late";
 *  3. a real quantity in a real unit — an amount beside a measure word
 *     ("spent 2 hours") is not money.
 */
export function parseFitnessLog(text: string): ParseResult {
  const t = String(text || '');
  const lower = t.toLowerCase();

  if (isQuestion(t) || isPlanOrRequest(t)) return { status: 'none' };

  const n = findNumber(t);
  const qty = n && n.value > 0 ? n.value : null;
  // A log either says something happened, asks to record it, or is nothing but
  // a quantity and its topic ("20 pushups", "2 roti").
  const reported = hasDoneWord(lower) || hasLogVerb(lower) || t.trim().split(/\s+/).length <= 3;

  // --- Sleep ---
  const sleptVerb = hasPhrase(lower, 'slept', 'soya', 'soyi', 'so gaya', 'so gayi', 'neend aayi', 'neend aa gayi');
  const sleepHours = hasWord(lower, 'ghante', 'ghanta', 'ghanton', 'hour', 'hours', 'hr', 'hrs');
  if (sleptVerb || (hasWord(lower, 'sleep', 'neend', 'soya') && sleepHours)) {
    const hrs = qty !== null && qty <= 20 ? qty : undefined;
    if (hrs !== undefined || sleptVerb) {
      return {
        status: 'ok',
        log: {
          kind: 'sleep',
          label: hrs !== undefined ? `Slept ${hrs} hrs` : 'Sleep logged',
          qty: hrs,
          unit: 'hrs',
        },
      };
    }
  }

  // --- Energy ---
  if (
    hasWord(lower, 'energy', 'tired', 'thak', 'thakan', 'thakaan', 'fresh', 'exhausted', 'lazy', 'susti') &&
    hasWord(lower, 'low', 'kam', 'high', 'full', 'good', 'bad', 'tired', 'thak', 'thakan', 'thakaan', 'fresh', 'zyada', 'zyaada')
  ) {
    const level = hasWord(lower, 'high', 'full', 'fresh', 'good', 'energetic')
      ? 'high'
      : hasWord(lower, 'low', 'kam', 'tired', 'thak', 'exhausted', 'lazy', 'susti')
        ? 'low'
        : 'medium';
    return { status: 'ok', log: { kind: 'energy', label: `Energy ${level}`, detail: level } };
  }

  // --- Water ---
  if (hasWord(lower, 'pani', 'paani', 'water')) {
    const drank = hasPhrase(lower, 'piya', 'pi liya', 'pi', 'drank');
    const vessel = hasWord(lower, 'glass', 'glasses', 'bottle', 'bottles', 'litre', 'litres', 'liter', 'liters', 'ml');
    if (drank || (qty !== null && vessel)) {
      const isLitre = hasWord(lower, 'litre', 'litres', 'liter', 'liters', 'bottle', 'bottles');
      const amount = qty ?? 1;
      return {
        status: 'ok',
        log: {
          kind: 'water',
          label: isLitre ? `Water ${amount} L` : `Water ${amount} glass`,
          qty: amount,
          unit: isLitre ? 'L' : 'glass',
        },
      };
    }
  }

  // --- Weight ---
  if (hasWord(lower, 'weight', 'vajan', 'vazan', 'wajan')) {
    if (
      qty !== null && qty > 20 && qty < 300 &&
      (hasWord(lower, 'kg', 'kilo', 'kilos', 'is', 'hai', 'tha', 'thi', 'now', 'aaj', 'today') ||
        hasDoneWord(lower))
    )
      return { status: 'ok', log: { kind: 'weight', label: `Weight ${qty} kg`, qty, unit: 'kg' } };
  }

  // --- Expense ("kharcha 200 chai") ---
  const sym = moneyAmount(t);
  const amount = sym ? sym.amount : qty;
  if (amount !== null && (sym || hasMoneyContext(lower)) && !mentionsMeasureUnit(lower)) {
    // Strip the money words as WHOLE words: an unanchored `rs` strip ate letters
    // out of the item name (audit finding I17).
    const item = stripWords(
      t
        .replace(/[₹$€]/g, ' ')
        .replace(/\b(rs\.?|inr|usd|eur)\b/gi, ' ')
        .replace(/\d[\d,]*(?:\.\d+)?/g, ' '),
      ...MONEY_WORDS,
      'lag', 'gaye', 'gaya', 'gayi', 'kiya', 'hua', 'diya', 'diye', 'paise',
    );
    return {
      status: 'ok',
      log: {
        kind: 'expense',
        label: item ? `Spent ₹${amount} — ${item}` : `Spent ₹${amount}`,
        qty: amount,
        unit: 'INR',
        amount,
        currency: sym?.currency || 'INR',
        detail: item || undefined,
      },
    };
  }

  // --- Cardio / distance / gym ---
  const kmDigits = lower.match(/(\d[\d,]*(?:\.\d+)?)\s*(km|kilometer|kilometre)\b/);
  const kmValue = kmDigits
    ? Number(kmDigits[1].replace(/,/g, ''))
    : qty !== null && hasWord(lower, 'km', 'kilometer', 'kilometre')
      ? qty
      : null;
  if (kmValue !== null && hasWord(lower, 'run', 'daud', 'ran', 'walk', 'chal', 'chala', 'chali', 'cycle', 'cycling', 'swim', 'treadmill')) {
    const act = hasWord(lower, 'run', 'daud', 'ran')
      ? 'Run'
      : hasWord(lower, 'walk', 'chal', 'chala', 'chali')
        ? 'Walk'
        : hasWord(lower, 'cycle', 'cycling')
          ? 'Cycling'
          : hasWord(lower, 'swim')
            ? 'Swim'
            : 'Cardio';
    return { status: 'ok', log: { kind: 'workout', label: `${act} ${kmValue} km`, qty: kmValue, unit: 'km' } };
  }
  const mins = lower.match(/\b(\d+)\s*(mins?|minutes?)\b/);
  if (mins && hasWord(lower, 'gym', 'workout', 'yoga', 'walk', 'run', 'exercise', 'kasrat', 'cardio', 'zumba', 'dance')) {
    const act = hasWord(lower, 'yoga')
      ? 'Yoga'
      : hasWord(lower, 'walk')
        ? 'Walk'
        : hasWord(lower, 'run')
          ? 'Run'
          : hasWord(lower, 'gym')
            ? 'Gym'
            : 'Workout';
    return { status: 'ok', log: { kind: 'workout', label: `${act} ${mins[1]} min`, qty: Number(mins[1]), unit: 'mins' } };
  }
  if (hasWord(lower, 'gym') && hasWord(lower, 'gaya', 'gayee', 'gayi', 'done', 'kiya', 'kar liya', 'ho gaya', 'complete', 'completed')) {
    return {
      status: 'ok',
      log: {
        kind: 'workout',
        label: qty !== null ? `Gym ${qty} min` : 'Gym session',
        qty: qty ?? undefined,
        unit: qty !== null ? 'mins' : undefined,
      },
    };
  }

  // --- Counted exercises ---
  for (const ex of EXERCISES) {
    if (!ex.re.test(lower)) continue;
    if (qty !== null && qty <= 10000 && (reported || /\d/.test(t))) {
      return {
        status: 'ok',
        log: { kind: 'workout', label: `${qty} ${ex.label}`, qty, unit: ex.unit },
      };
    }
    if (reported) return { status: 'ok', log: { kind: 'workout', label: ex.label } };
  }

  // --- Food ---
  const ateVerb = hasPhrase(lower, 'ate', 'eaten', 'khaya', 'khayi', 'khaaya', 'kha liya', 'kha', 'piya');
  const mealWord = hasWord(lower, 'breakfast', 'lunch', 'dinner', 'nashta', 'meal', 'snack', 'khana');
  if (ateVerb || mealWord) {
    for (const f of FOODS) {
      if (!f.re.test(lower)) continue;
      const amount = qty !== null && qty <= 30 ? qty : 1;
      return {
        status: 'ok',
        log: {
          kind: 'food',
          label: `${amount > 1 ? `${amount} ` : ''}${f.label}`,
          qty: amount,
          unit: f.unit,
          calories: Math.round(f.kcal * amount),
          detail: '≈ estimate, home-style',
        },
      };
    }
    // A meal was eaten but no known food was named — still worth logging.
    if (ateVerb || mealWord) {
      return { status: 'ok', log: { kind: 'food', label: 'Meal logged', detail: t.slice(0, 80) } };
    }
  }

  // --- Bare number + ambiguous ("200" alone after a nudge, or "log 200") ---
  if (/^\s*(\d+)\s*$/.test(t)) {
    const v = Number(t.trim());
    return {
      status: 'ambiguous',
      value: v,
      candidates: ['pushups (reps)', 'rupees (kharcha)', 'water (glasses)'],
      raw: t.trim(),
    };
  }
  return { status: 'none' };
}

/** Resolve an ambiguous number with the user's answer ("pushups", "rupaye", "paani"). */
export function resolveAmbiguous(value: number, answer: string): ParseResult {
  const a = String(answer || '').toLowerCase();
  if (/(pushup|dand|reps|situp|squat|pullup|exercise|kasrat)/.test(a))
    return { status: 'ok', log: { kind: 'workout', label: `${value} Pushups`, qty: value, unit: 'reps' } };
  if (/(rup|rs|inr|kharcha|spent|paise|money)/.test(a))
    return { status: 'ok', log: { kind: 'expense', label: `Spent ₹${value}`, qty: value, unit: 'INR', amount: value, currency: 'INR' } };
  if (/(paani|water|glass)/.test(a))
    return { status: 'ok', log: { kind: 'water', label: `Water ${value} glass`, qty: value, unit: 'glass' } };
  if (/(roti|kha|khana|food|calor)/.test(a))
    return { status: 'ok', log: { kind: 'food', label: `Meal (${value} kcal approx)`, calories: value, detail: 'user-stated' } };
  if (/(sleep|soya|ghante)/.test(a) && value <= 20)
    return { status: 'ok', log: { kind: 'sleep', label: `Slept ${value} hrs`, qty: value, unit: 'hrs' } };
  return { status: 'none' };
}

export function dayKey(ts: number, d = new Date(ts)): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

export interface DayTotals {
  key: string;
  workouts: string[];
  workoutCount: number;
  foodCalories: number;
  foodItems: number;
  spend: number;
  sleepHrs?: number;
  energy?: string;
  waterGlass?: number;
  weightKg?: number;
}

export function dayTotals(logs: FitnessLog[], key: string): DayTotals {
  const day = logs.filter((l) => dayKey(l.createdAt) === key);
  const totals: DayTotals = {
    key, workouts: [], workoutCount: 0, foodCalories: 0, foodItems: 0, spend: 0,
  };
  for (const l of day) {
    if (l.kind === 'workout') {
      totals.workoutCount++;
      totals.workouts.push(l.label);
    } else if (l.kind === 'food') {
      totals.foodItems++;
      totals.foodCalories += l.calories || 0;
    } else if (l.kind === 'expense') {
      totals.spend += l.amount || l.qty || 0;
    } else if (l.kind === 'sleep' && l.qty) {
      totals.sleepHrs = (totals.sleepHrs || 0) + l.qty;
    } else if (l.kind === 'energy' && l.detail) {
      totals.energy = l.detail;
    } else if (l.kind === 'water' && l.qty) {
      totals.waterGlass = (totals.waterGlass || 0) + (l.unit === 'L' ? l.qty * 4 : l.qty);
    } else if (l.kind === 'weight' && l.qty) {
      totals.weightKg = l.qty;
    }
  }
  return totals;
}

export interface Streaks {
  logDays: number;
  workoutDays: number;
}

/** Consecutive-day streaks ending today or yesterday. */
export function computeStreaks(logs: FitnessLog[], now = Date.now()): Streaks {
  const byDay = new Map<string, { any: boolean; workout: boolean }>();
  for (const l of logs) {
    const k = dayKey(l.createdAt);
    const e = byDay.get(k) || { any: false, workout: false };
    e.any = true;
    if (l.kind === 'workout') e.workout = true;
    byDay.set(k, e);
  }
  const out: Streaks = { logDays: 0, workoutDays: 0 };
  const d = new Date(now);
  // Allow today to be empty (streak alive if yesterday logged).
  let k = dayKey(d.getTime(), d);
  if (!byDay.get(k)?.any) d.setDate(d.getDate() - 1);
  for (;;) {
    k = dayKey(d.getTime(), d);
    const e = byDay.get(k);
    if (!e?.any) break;
    out.logDays++;
    d.setDate(d.getDate() - 1);
    if (out.logDays > 3650) break;
  }
  const w = new Date(now);
  let wk = dayKey(w.getTime(), w);
  if (!byDay.get(wk)?.workout) w.setDate(w.getDate() - 1);
  for (;;) {
    wk = dayKey(w.getTime(), w);
    const e = byDay.get(wk);
    if (!e?.workout) break;
    out.workoutDays++;
    w.setDate(w.getDate() - 1);
    if (out.workoutDays > 3650) break;
  }
  return out;
}

/** Push-or-rest call from sleep + energy + recent load. Not medical advice. */
export function recoveryLine(input: {
  sleepHrs?: number;
  energy?: string;
  workoutsLast3Days: number;
}): string {
  const { sleepHrs, energy, workoutsLast3Days } = input;
  if (sleepHrs !== undefined && sleepHrs < 5.5)
    return 'Recovery: light day. You slept under 5.5 hours — walk or stretch, skip the intense workout, and protect tonight’s sleep.';
  if (energy === 'low' && workoutsLast3Days >= 2)
    return 'Recovery: rest day. Low energy plus recent training means your body is asking for recovery — easy walk only.';
  if (energy === 'low')
    return 'Recovery: easy day. Low energy — do half your normal workout or just move lightly for 20 minutes.';
  if (workoutsLast3Days >= 3)
    return 'Recovery: you trained 3 days straight — today is a good rest or mobility day so the work pays off.';
  if (sleepHrs !== undefined && sleepHrs >= 7 && energy !== 'low')
    return 'Recovery: green light. Good sleep — a solid workout day if your schedule allows.';
  return 'Recovery: no strong signal today. A moderate workout is fine — log your sleep tonight for a sharper call tomorrow.';
}

export function formatLogLine(l: FitnessLog): string {
  const time = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(l.createdAt));
  const icon = l.kind === 'workout' ? '💪' : l.kind === 'food' ? '🍛' : l.kind === 'expense' ? '💸'
    : l.kind === 'sleep' ? '😴' : l.kind === 'energy' ? '⚡' : l.kind === 'water' ? '💧' : '⚖️';
  return `${icon} ${l.label} · ${time}`;
}

export function spokenConfirm(l: Omit<FitnessLog, 'id' | 'createdAt' | 'source'>): string {
  if (l.kind === 'workout') return `Logged — ${l.label}. Shabaash!`;
  if (l.kind === 'food') return l.calories ? `Logged — ${l.label}, roughly ${l.calories} calories.` : `Logged — ${l.label}.`;
  if (l.kind === 'expense') return `Logged — kharcha ₹${l.amount}.`;
  if (l.kind === 'sleep') return `Logged — ${l.label}.`;
  if (l.kind === 'energy') return `Noted — energy ${l.detail}. I'll factor it into today's plan.`;
  if (l.kind === 'water') return `Logged — ${l.label}.`;
  return `Logged — ${l.label}.`;
}

/** Compact device-log block for AI context: recent fitness/food/expense/sleep
 *  entries the model would otherwise never see (they live outside chat).
 *  Newest first, capped so small models never overflow. Pure + tested. */
export function formatLogsForContext(logs: FitnessLog[], limit = 12): string {
  const recent = [...(logs || [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit));
  if (!recent.length) return '';
  const lines = recent.map((l) => {
    const d = new Date(l.createdAt);
    const day = `${d.getDate()}/${d.getMonth() + 1}`;
    const extra =
      l.kind === 'expense'
        ? ` ₹${l.amount ?? l.qty ?? ''}`
        : l.kind === 'food' && l.calories
          ? ` ~${l.calories}kcal`
          : l.qty != null && l.unit
            ? ` ${l.qty}${l.unit}`
            : '';
    return `- ${day} · ${l.kind}: ${l.label}${extra}`;
  });
  return (
    'Recently logged on this device (fitness/food/expense/sleep log):\n' +
    lines.join('\n')
  );
}

// A repair has to POINT at the row it wants changed. Audit finding I3: the old
// test was "contains change|correct|galat|wrong|nahi|fix|pichla + any number",
// so "change 5" and "yeh galat hai, 2 baar bolna pada" silently rewrote the last
// expense — the second one to ₹2, taken out of "2 baar".
const NAMES_LAST_ROW = [
  'last log', 'last entry', 'last one', 'last item', 'last wala', 'last wali', 'last record',
  'previous entry', 'previous log', 'pichla', 'pichhla', 'pichli', 'abhi wala', 'jo abhi',
  'this entry', 'yeh entry', 'ye entry',
];
const REPAIR_MARKERS = [
  'it was', 'it should be', 'should be', 'should have been', 'actually', 'make it',
  'change it to', 'correct it to', 'set it to', 'i meant', 'mera matlab', 'matlab tha',
];
const REPAIR_VERBS = ['change', 'correct', 'fix', 'update', 'galat', 'wrong', 'badal', 'badlo', 'theek'];
/** A short negation up front corrects what was just said: "nahi 3 roti". */
const NEGATIVE_START = /^(nahi|nahin|no|not|galat|wrong)\b/i;

/**
 * "change last log to 60" / "last wala saath kar do" / "wrong, it was 10".
 * Returns the corrected value, or null when the sentence does not point at the
 * last row.
 */
export function detectLogRepair(text: string): number | null {
  const t = String(text || '').trim();
  if (!t || isQuestion(t)) return null;
  const lower = t.toLowerCase();
  const namesIt = hasPhrase(lower, ...NAMES_LAST_ROW);
  let marker = REPAIR_MARKERS.find((m) => hasPhrase(lower, m)) || null;
  const shortNegation = NEGATIVE_START.test(t) && lower.split(/\s+/).length <= 6;
  // "aaj ka kharcha 500 tha" — stating what a value WAS, about something this
  // app logs, right after logging it, is a correction. Kept narrow: short, a log
  // topic, no measured unit ("20 minute chala tha" is a duration, not a number
  // to write over the last row).
  const pastStatement =
    !marker &&
    lower.split(/\s+/).length <= 7 &&
    !mentionsMeasureUnit(lower) &&
    /\b\d[\d,]*(?:\.\d+)?\s*(?:tha|thi|the|was|were)\b/.test(lower) &&
    hasWord(lower, 'kharcha', 'kharach', 'kharch', 'spent', 'spend', 'paid', 'bill', 'paisa', 'paise',
      'rupay', 'roti', 'khana', 'khaya', 'khaana', 'paani', 'water', 'neend', 'sleep', 'vazan', 'weight',
      'calorie', 'calories', 'pushups', 'baithak', 'steps');
  if (!namesIt && !marker && !shortNegation && !pastStatement) return null;
  // "pichla entry hata do" names the row but asks for a delete, not a repair.
  if (namesIt && !marker && !pastStatement && !hasWord(lower, ...REPAIR_VERBS)) return null;
  // The corrected value is the number AFTER the marker when there is one:
  // "not 6, it was 8" means 8, and "it was 500 not 200" means 500. A past-tense
  // statement puts the number first ("kharcha 500 tha"), so scan the whole line.
  const from = marker ? lower.indexOf(marker) + marker.length : 0;
  const n = findNumber(t.slice(from), {
    allowAmbiguous: namesIt || !!marker || pastStatement,
  });
  return n && n.value > 0 ? n.value : null;
}

const DELETE_VERBS = [
  'delete', 'remove', 'hata', 'hatao', 'mita', 'mitao', 'nikaal', 'nikal', 'drop', 'erase',
];

/** "delete the last one" / "pichla entry hata do" — remove the newest log row. */
export function detectLogDelete(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || isQuestion(t)) return false;
  const lower = t.toLowerCase();
  if (lower.split(/\s+/).length > 8) return false;
  return (
    hasPhrase(lower, ...NAMES_LAST_ROW) &&
    hasPhrase(lower, ...DELETE_VERBS, 'hata do', 'hata doon', 'delete kar do', 'remove kar do')
  );
}

// Deliberately no "cancel": that word belongs to task cancellation, and stealing
// it here would undo a log when the user meant a reminder.
const UNDO_WORDS = ['undo', 'revert', 'wapas', 'take that back', 'take it back'];

/** "undo" / "undo that" / "wapas kar do" — put back what the last edit changed. */
export function isUndoPhrase(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || isQuestion(t)) return false;
  const lower = t.toLowerCase();
  if (lower.split(/\s+/).length > 4) return false;
  return hasPhrase(lower, ...UNDO_WORDS, 'wapas kar do', 'wapas karo', 'undo kar do', 'pichla wapas');
}
