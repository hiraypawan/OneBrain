import { dayKey } from './fitness';
import { plainMoney, trackHref, type TodayStrip } from './track';
import type { TodoCounts } from './todo';

/**
 * Today’s brief, computed as data.
 *
 * Today used to be the whole workspace — four view tabs, a canvas, a search box
 * and a receipt log — which meant the first thing a person saw was a tool
 * cabinet. This module is the replacement: a greeting, a date, and only the
 * facts that are actually true right now. Nothing here invents a number: a
 * lens with nothing logged contributes no fact at all, and the caller says so.
 */

export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening' | 'Still awake?';

/** Four bands, because “good evening” at 3am is a lie people can see through. */
export function greetingFor(now: Date = new Date()): Greeting {
  const h = now.getHours();
  if (h < 5) return 'Still awake?';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** “Wednesday · 17 September” — no year: this line is about today. */
export function dateLine(now: Date = new Date()): string {
  try {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(now);
    const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(now);
    return `${weekday} · ${day}`;
  } catch {
    return now.toDateString();
  }
}

export type BriefFactId = 'tasks' | 'money' | 'food' | 'sleep' | 'workouts';

export interface BriefFact {
  id: BriefFactId;
  label: string;
  value: string;
  /** Optional qualifier, e.g. “2 overdue”. Never a second number to parse. */
  note?: string;
  /** Deep link into the lens/tab that owns the detail. */
  href: string;
}

export interface BriefInput {
  counts: TodoCounts;
  strip: TodayStrip;
  goals: { kcalGoal: number; budget: number; budgetCurrency?: string };
  /** Saved canvas records, for the “nothing yet” sentence. */
  items: number;
}

/**
 * The one sentence under the greeting. `summarizeDay` already reads the real
 * records; without any, we say that instead of a pleasantry.
 */
export function briefLine(input: BriefInput, summary: string): string {
  if (input.items === 0 && input.strip.entries === 0 && input.counts.open === 0) {
    return 'Nothing saved yet. Write or speak one thing above and it will be waiting here.';
  }
  return summary;
}

/** Facts worth a glance, in the order a person acts on them. */
export function briefFacts(input: BriefInput, now: Date = new Date()): BriefFact[] {
  const day = dayKey(now.getTime(), now);
  const facts: BriefFact[] = [];
  const { counts, strip, goals } = input;

  if (counts.open || counts.dueToday || counts.overdue) {
    facts.push({
      id: 'tasks',
      label: 'Open',
      value: `${counts.open} ${counts.open === 1 ? 'thing' : 'things'}`,
      note: counts.dueToday
        ? `${counts.dueToday} to today${counts.overdue ? `, ${counts.overdue} overdue` : ''}`
        : counts.overdue
          ? `${counts.overdue} overdue`
          : undefined,
      href: '/control?panel=tasks',
    });
  }
  if (strip.spend > 0) {
    facts.push({
      id: 'money',
      label: 'Spent today',
      value: plainMoney(strip.spend, goals.budgetCurrency),
      // Today’s number and the month’s limit are different things, so the note
      // says which one it is rather than quoting a two-currency sentence.
      note: strip.budget?.set
        ? `of ${plainMoney(strip.budget.limit, goals.budgetCurrency)} this month`
        : undefined,
      href: trackHref({ lens: 'expenses', range: 'day', day }),
    });
  }
  if (strip.kcal > 0) {
    facts.push({
      id: 'food',
      label: 'Food today',
      value: `≈${strip.kcal} kcal`,
      note: `of about ${goals.kcalGoal}`,
      href: trackHref({ lens: 'food', range: 'day', day }),
    });
  }
  if (typeof strip.sleep === 'number' && strip.sleep > 0) {
    facts.push({
      id: 'sleep',
      label: 'Sleep',
      value: `${strip.sleep} h`,
      href: trackHref({ lens: 'health', range: 'day', day }),
    });
  }
  if (strip.workouts > 0 || strip.streak > 0) {
    facts.push({
      id: 'workouts',
      label: 'Movement',
      value: strip.workouts ? `${strip.workouts} logged today` : 'Nothing today',
      note: strip.streak > 1 ? `${strip.streak}-day streak` : undefined,
      href: trackHref({ lens: 'workouts', range: 'day', day }),
    });
  }
  return facts;
}
