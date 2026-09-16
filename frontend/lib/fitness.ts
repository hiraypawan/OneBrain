// Voice fitness + food + expense + sleep/energy logging.
// "20 pushups kar liye" / "2 roti khayi" / "kharcha 200 chai" / "6 ghante soya".
// Pure parsers + totals + streaks + recovery advice. Calorie figures are rough
// home-style estimates and are ALWAYS labeled as such — never medical advice.

import { findNumber } from './numbers';

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
  { re: /push[\s-]?ups?|dand\b|dund\b/, label: 'Pushups', unit: 'reps' },
  { re: /pull[\s-]?ups?|chin[\s-]?ups?/, label: 'Pullups', unit: 'reps' },
  { re: /baithak|squats?|uthak/, label: 'Squats', unit: 'reps' },
  { re: /sit[\s-]?ups?|crunch/, label: 'Situps', unit: 'reps' },
  { re: /lunges?/, label: 'Lunges', unit: 'reps' },
  { re: /burpees?/, label: 'Burpees', unit: 'reps' },
  { re: /jumping jacks?/, label: 'Jumping jacks', unit: 'reps' },
  { re: /plank/, label: 'Plank', unit: 'sec' },
  { re: /surya namaskar|suryanamaskar/, label: 'Surya Namaskar', unit: 'rounds' },
  { re: /skipping|jump ?rope|rassi/, label: 'Skipping', unit: 'mins' },
  { re: /push[\s-]?up/, label: 'Pushups', unit: 'reps' },
];

// Rough home-style estimates (kcal). Labeled approximate everywhere shown.
const FOODS: { re: RegExp; label: string; kcal: number; unit: string }[] = [
  { re: /\broti\b|chapati|phulka/, label: 'Roti', kcal: 70, unit: 'pc' },
  { re: /paratha|parantha/, label: 'Paratha', kcal: 180, unit: 'pc' },
  { re: /rajma chawal|rajma rice/, label: 'Rajma chawal', kcal: 450, unit: 'plate' },
  { re: /chole (bhature|chawal|rice)|chana/, label: 'Chole', kcal: 400, unit: 'plate' },
  { re: /dal(?!\w)|daal/, label: 'Dal', kcal: 150, unit: 'bowl' },
  { re: /rice|chawal|bhaat/, label: 'Rice', kcal: 200, unit: 'bowl' },
  { re: /khichdi/, label: 'Khichdi', kcal: 300, unit: 'bowl' },
  { re: /samosa/, label: 'Samosa', kcal: 250, unit: 'pc' },
  { re: /pakora|pakoda|bhaji/, label: 'Pakora', kcal: 200, unit: 'plate' },
  { re: /chai\b|tea/, label: 'Chai', kcal: 60, unit: 'cup' },
  { re: /coffee/, label: 'Coffee', kcal: 50, unit: 'cup' },
  { re: /milk|doodh/, label: 'Milk', kcal: 120, unit: 'glass' },
  { re: /banana|kela/, label: 'Banana', kcal: 105, unit: 'pc' },
  { re: /apple|seb\b/, label: 'Apple', kcal: 95, unit: 'pc' },
  { re: /egg|anda|omelette/, label: 'Eggs', kcal: 80, unit: 'pc' },
  { re: /paneer/, label: 'Paneer dish', kcal: 250, unit: 'bowl' },
  { re: /chicken/, label: 'Chicken', kcal: 300, unit: 'serving' },
  { re: /maggi|noodles/, label: 'Noodles', kcal: 350, unit: 'pack' },
  { re: /dosa/, label: 'Dosa', kcal: 170, unit: 'pc' },
  { re: /idli/, label: 'Idli', kcal: 60, unit: 'pc' },
  { re: /poha/, label: 'Poha', kcal: 250, unit: 'plate' },
  { re: /upma/, label: 'Upma', kcal: 250, unit: 'plate' },
  { re: /sandwich/, label: 'Sandwich', kcal: 250, unit: 'pc' },
  { re: /pizza/, label: 'Pizza', kcal: 550, unit: 'serving' },
  { re: /burger/, label: 'Burger', kcal: 500, unit: 'pc' },
  { re: /thali/, label: 'Thali', kcal: 700, unit: 'thali' },
  { re: /salad/, label: 'Salad', kcal: 100, unit: 'bowl' },
  { re: /curd|dahi|yogurt|raita/, label: 'Curd', kcal: 100, unit: 'bowl' },
  { re: /lunch|khana/, label: 'Lunch', kcal: 500, unit: 'meal' },
  { re: /dinner/, label: 'Dinner', kcal: 500, unit: 'meal' },
  { re: /breakfast|nashta/, label: 'Breakfast', kcal: 300, unit: 'meal' },
];

const MONEY_RE = /(?:₹\s*|\brs\.?\s*|\binr\s*|\$\s*|\busd\s*)?(\d[\d,]*(?:\.\d+)?)/i;

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

export function parseFitnessLog(text: string): ParseResult {
  const t = String(text || '');
  const lower = t.toLowerCase();

  // --- Sleep ---
  if (/(slept|sleep|soya|soyi|neend)/.test(lower) && !/sleep (mode|well tonight)/.test(lower)) {
    const n = findNumber(t);
    const hrs = n && n.value > 0 && n.value <= 20 ? n.value : undefined;
    if (hrs !== undefined || /(ghante|hours?|hour)/.test(lower)) {
      return {
        status: 'ok',
        log: { kind: 'sleep', label: hrs !== undefined ? `Slept ${hrs} hrs` : 'Sleep logged', qty: hrs, unit: 'hrs' },
      };
    }
  }
  // --- Energy ---
  if (/\b(energy|tired|thak|thakan|thakaan|fresh|exhausted|lazy|susti)\b/.test(lower) &&
      /\b(low|kam|high|full|good|bad|tired|thak|thakan|thakaan|fresh|zyada|zyaada)\b/.test(lower)) {
    const level = /(high|full|fresh|good|energetic)/.test(lower) ? 'high'
      : /(low|kam|tired|thak|exhausted|lazy|susti)/.test(lower) ? 'low' : 'medium';
    return { status: 'ok', log: { kind: 'energy', label: `Energy ${level}`, detail: level } };
  }
  // --- Water ---
  if (/(glass|litre|liter|ml|bottle|pani|water)/.test(lower) && /(pani|water|glass|litre|liter)/.test(lower) &&
      !/(swim|pool|nahaya|bath)/.test(lower)) {
    const n = findNumber(t);
    if (/(piya|drank|pi liya)/.test(lower) || n) {
      const isLitre = /litre|liter|bottle/.test(lower);
      const qty = n ? n.value : 1;
      return {
        status: 'ok',
        log: { kind: 'water', label: isLitre ? `Water ${qty} L` : `Water ${qty} glass`, qty, unit: isLitre ? 'L' : 'glass' },
      };
    }
  }
  // --- Weight ---
  if (/(weight|vajan|vazan|wajan)/.test(lower)) {
    const n = findNumber(t);
    if (n && n.value > 20 && n.value < 300) {
      return { status: 'ok', log: { kind: 'weight', label: `Weight ${n.value} kg`, qty: n.value, unit: 'kg' } };
    }
  }
  // --- Expense ("kharcha 200 chai") ---
  if (/(kharcha|kharach|spent|spend|paid|diya|diye|payment kiya|lag gaye)/.test(lower)) {
    const sym = moneyAmount(t);
    const n = findNumber(t);
    const amount = sym ? sym.amount : n && n.value > 0 ? n.value : null;
    if (amount !== null) {
      const item = t
        .replace(/(kharcha|kharach|spent|spend|paid|diya|diye|payment kiya|lag gaye)/gi, '')
        .replace(/₹|rs\.?|inr|\$|usd/gi, '')
        .replace(/\d[\d,]*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        status: 'ok',
        log: {
          kind: 'expense', label: item ? `Spent ₹${amount} — ${item}` : `Spent ₹${amount}`,
          qty: amount, unit: 'INR', amount, currency: sym?.currency || 'INR',
          detail: item || undefined,
        },
      };
    }
  }
  // --- Cardio / distance / gym ---
  const km = lower.match(/(\d[\d,]*(?:\.\d+)?)\s*(km|kilometer|kilometre)/) ||
    (() => { const n = findNumber(t); return /(km|kilometer)/.test(lower) && n ? [ '', String(n.value), 'km' ] as const : null; })();
  if (km && (/(run|daud|ran|walk|chal|chala|cycle|swim|treadmill)/.test(lower))) {
    const v = Number(km[1]);
    const act = /(run|daud|ran)/.test(lower) ? 'Run' : /(walk|chal)/.test(lower) ? 'Walk' : /(cycle)/.test(lower) ? 'Cycling' : /(swim)/.test(lower) ? 'Swim' : 'Cardio';
    return { status: 'ok', log: { kind: 'workout', label: `${act} ${v} km`, qty: v, unit: 'km' } };
  }
  const mins = lower.match(/(\d+)\s*(min|minute)/);
  if (mins && /(gym|workout|yoga|walk|run|exercise|kasrat|cardio|zumba|dance)/.test(lower)) {
    const act = /(yoga)/.test(lower) ? 'Yoga' : /(walk)/.test(lower) ? 'Walk' : /(run)/.test(lower) ? 'Run' : /(gym)/.test(lower) ? 'Gym' : 'Workout';
    return { status: 'ok', log: { kind: 'workout', label: `${act} ${mins[1]} min`, qty: Number(mins[1]), unit: 'mins' } };
  }
  if (/\bgym\b/.test(lower) && /(gaya|gayee|gayi|done|kiya|kar liya|ho gaya|complete)/.test(lower)) {
    const n = findNumber(t);
    return {
      status: 'ok',
      log: { kind: 'workout', label: n ? `Gym ${n.value} min` : 'Gym session', qty: n?.value, unit: n ? 'mins' : undefined },
    };
  }
  // --- Counted exercises ---
  for (const ex of EXERCISES) {
    if (ex.re.test(lower)) {
      const n = findNumber(t);
      if (n && n.value > 0 && n.value <= 10000) {
        return {
          status: 'ok',
          log: { kind: 'workout', label: `${n.value} ${ex.label}`, qty: n.value, unit: ex.unit },
        };
      }
      if (/(kar liye|kiye|kiye|done|ho gaye|complete|kiya)/.test(lower)) {
        return { status: 'ok', log: { kind: 'workout', label: ex.label } };
      }
    }
  }
  // --- Food ---
  if (/(ate|khaya|khayi|kha liya|khaa|breakfast|lunch|dinner|nashta|meal|snack|piya)/.test(lower) || FOODS.some((f) => f.re.test(lower) && /(khaya|ate|kha|piya|liye|liya)/.test(lower))) {
    for (const f of FOODS) {
      if (f.re.test(lower)) {
        const n = findNumber(t);
        const qty = n && n.value > 0 && n.value <= 30 ? n.value : 1;
        return {
          status: 'ok',
          log: {
            kind: 'food', label: `${qty > 1 ? `${qty} ` : ''}${f.label}`,
            qty, unit: f.unit, calories: Math.round(f.kcal * qty),
            detail: '≈ estimate, home-style',
          },
        };
      }
    }
    // Generic "kha liya" without a known food — still log it.
    if (/(khaya|khayi|kha liya|ate|meal|khana kha)/.test(lower)) {
      return { status: 'ok', log: { kind: 'food', label: 'Meal logged', detail: t.slice(0, 80) } };
    }
  }
  // --- Bare number + ambiguous ("200" alone after a nudge, or "log 200") ---
  const bare = lower.match(/^(log|note|add)?\s*(\d+)\s*$/) || lower.match(/^(log|note)\s+(.+)$/);
  if (bare && /^\s*(\d+)\s*$/.test(t)) {
    const v = Number(t.trim());
    return { status: 'ambiguous', value: v, candidates: ['pushups (reps)', 'rupees (kharcha)', 'water (glasses)'], raw: t.trim() };
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

/** "change last log to 60" / "last wala 60 kar do" repair command. */
export function detectLogRepair(text: string): number | null {
  const t = String(text || '').toLowerCase();
  if (!/(change|correct|galat|wrong|nahi|fix|last (wala|entry|log)|pichla)/.test(t)) return null;
  const n = findNumber(t);
  return n && n.value > 0 ? n.value : null;
}
