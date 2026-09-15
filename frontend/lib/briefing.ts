// Daily intelligence: morning brief, close-my-day, forgetting scan,
// follow-up radar (commitment detection), money guard. All compiled from
// on-device data only — reminders, workspace items, messages, fitness,
// night notes. Pure + tested.

import { parseDateRef } from './timetravel';

export interface Commitment {
  id: string;
  text: string;
  dueKey: string | null; // YYYY-MM-DD or null
  createdAt: number;
  done: boolean;
}

export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`;
}

const COMMIT_RE = [
  /\bi (will|'ll|promise to|am going to)\b/i,
  /\b(promise|pakka|wada)\b/i,
  /\b(send|bhej|bhejunga|bhejungi|de dunga|de dungi|kar dunga|kar dungi|kar loonga|kar loongi)\b/i,
  /\bby (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|evening|morning|kal|parso)\b/i,
  /\bkal (tak|subah|shaam|pakka|bhej|kar|de)\b/i,
];

const NOT_COMMIT = /^(what|when|where|who|how|why|kya|kab|kaun|kaise|will you|can you|please)/i;

/** Sniff a user utterance for a self-commitment ("I'll send it by Tuesday"). */
export function detectCommitment(text: string, now: Date = new Date()): Omit<Commitment, 'id' | 'createdAt' | 'done'> | null {
  const t = String(text || '').trim();
  if (t.length < 8 || t.length > 300) return null;
  if (NOT_COMMIT.test(t)) return null;
  if (!COMMIT_RE.some((re) => re.test(t))) return null;
  // Must reference a future action, not a question.
  if (/\?$/.test(t)) return null;
  const range = parseDateRef(t, now, false);
  return {
    text: t.slice(0, 140),
    dueKey: range && range.key.length === 10 ? range.key : range ? range.key.slice(0, 10) : null,
  };
}

export type BriefIntent = 'morning' | 'close' | 'forgetting' | 'followups' | 'money' | null;

export function detectBriefIntent(text: string): BriefIntent {
  const t = String(text || '').toLowerCase().trim();
  if (/^(good morning|morning brief|brief me|aaj ka (brief|plan|summary)|din ki shuruat|start my day|day brief)/.test(t) ||
      /(morning brief|briefing sunao|aaj ka plan batao)/.test(t))
    return 'morning';
  if (/^(close my day|day close|din khatam|end my day|aaj ka hisab|wrap up)/.test(t) ||
      /(close (my|the) day|din ka (hisab|summary))/i.test(t))
    return 'close';
  if (/^(what am i forgetting|kya bhool|kuch bhool|bhool gaya|miss kar raha|forgetting anything)/.test(t))
    return 'forgetting';
  if (/(follow.?ups?|pending (hai|kaam|hai kya)|kis.?ko (jawab|reply)|waiting on me|meri taraf se)/.test(t) &&
      !/^(remind|yaad)/.test(t))
    return 'followups';
  if (/(money (due|pending|guard)|paise (dene|bharne)|bills? (due|pending)|kharcha (hisab|kitna)|emi|rent|recharge).*(batao|dikhao|kya|list)?/.test(t) ||
      /^(bills|dues|udhaar|udhar|dena hai)/.test(t))
    return 'money';
  return null;
}

export interface BriefData {
  reminders: { title: string; time: string; date?: string }[];
  openTasks: { title: string; due?: string }[];
  overdueTasks: { title: string; due?: string }[];
  doneToday: string[];
  commitments: Commitment[];
  moneyDue: { title: string; detail: string }[];
  nightCount: number;
  fitness: { sleepHrs?: number; energy?: string; workoutsLast3Days: number; spendToday: number };
  userName?: string;
}

export interface BriefResult {
  spoken: string;
  sections: { title: string; lines: string[] }[];
}

function greeting(now: Date, name?: string): string {
  const h = now.getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${g}, ${name}` : g;
}

export function compileMorningBrief(d: BriefData, now: Date = new Date()): BriefResult {
  const sections: BriefResult['sections'] = [];
  const today = d.reminders.filter((r) => !r.date || r.date <= todayKey(now));
  if (today.length) sections.push({ title: '⏰ Reminders today', lines: today.slice(0, 5).map((r) => `${r.time} — ${r.title}`) });
  if (d.overdueTasks.length) sections.push({ title: '🔴 Overdue', lines: d.overdueTasks.slice(0, 3).map((t) => t.title) });
  if (d.openTasks.length) sections.push({ title: '📌 Top tasks', lines: d.openTasks.slice(0, 3).map((t) => t.title) });
  const pending = d.commitments.filter((c) => !c.done);
  if (pending.length) sections.push({ title: '🤝 Promises to keep', lines: pending.slice(0, 3).map((c) => c.text) });
  if (d.moneyDue.length) sections.push({ title: '💸 Money due', lines: d.moneyDue.slice(0, 3).map((m) => `${m.title} — ${m.detail}`) });
  if (d.nightCount) sections.push({ title: '🌙 From last night', lines: [`${d.nightCount} thought${d.nightCount === 1 ? '' : 's'} waiting in your morning digest.`] });
  const energy: string[] = [];
  if (d.fitness.sleepHrs !== undefined) energy.push(`slept ${d.fitness.sleepHrs} hrs`);
  if (d.fitness.energy) energy.push(`energy ${d.fitness.energy}`);
  if (energy.length) sections.push({ title: '⚡ Body', lines: energy });
  const bits = [
    `${today.length} reminder${today.length === 1 ? '' : 's'}`,
    `${d.openTasks.length} open task${d.openTasks.length === 1 ? '' : 's'}`,
    pending.length ? `${pending.length} promise${pending.length === 1 ? '' : 's'} to keep` : '',
    d.moneyDue.length ? `${d.moneyDue.length} payment${d.moneyDue.length === 1 ? '' : 's'} due` : '',
  ].filter(Boolean);
  const spoken = `${greeting(now, d.userName)}! ${bits.length ? `Today: ${bits.join(', ')}.` : 'A clean slate today.'} ` +
    (d.overdueTasks.length ? `${d.overdueTasks[0].title} is overdue — knock that out first. ` : '') +
    (pending.length ? `And you promised: ${pending[0].text.slice(0, 70)}. ` : '') +
    'Full brief is on screen. Have a strong day!';
  return { spoken, sections };
}

export function compileCloseDay(d: BriefData): BriefResult {
  const sections: BriefResult['sections'] = [];
  if (d.doneToday.length) sections.push({ title: '✅ Finished today', lines: d.doneToday.slice(0, 6) });
  if (d.openTasks.length) sections.push({ title: '➡️ Rolls to tomorrow', lines: d.openTasks.slice(0, 5).map((t) => t.title) });
  const pending = d.commitments.filter((c) => !c.done);
  if (pending.length) sections.push({ title: '🤝 Still owed', lines: pending.slice(0, 3).map((c) => c.text) });
  if (d.fitness.spendToday > 0) sections.push({ title: '💸 Spent today', lines: [`₹${d.fitness.spendToday} logged`] });
  const top3 = d.openTasks.slice(0, 3).map((t) => t.title);
  const spoken = d.doneToday.length
    ? `Day closed! You finished ${d.doneToday.length} thing${d.doneToday.length === 1 ? '' : 's'} — ${d.doneToday.slice(0, 2).join(' and ')}. ` +
      (top3.length ? `Tomorrow's top 3: ${top3.join('; ')}. ` : '') + 'Rest well — I\'ll brief you in the morning.'
    : `Quiet day — nothing marked done. ${top3.length ? `Tomorrow, start with: ${top3[0]}.` : 'Set one task for tomorrow and sleep easy.'}`;
  return { spoken, sections };
}

export interface ForgettingResult {
  spoken: string;
  top: string[];
}

export function forgettingScan(d: BriefData): ForgettingResult {
  const top: string[] = [];
  if (d.overdueTasks.length) top.push(`Overdue: ${d.overdueTasks[0].title}`);
  const urgentCommit = d.commitments.find((c) => !c.done && c.dueKey && c.dueKey <= todayKey());
  if (urgentCommit) top.push(`You promised: ${urgentCommit.text}`);
  if (d.moneyDue.length) top.push(`Payment due: ${d.moneyDue[0].title}`);
  const todayRem = d.reminders.find((r) => !r.date || r.date <= todayKey());
  if (todayRem && top.length < 3) top.push(`Reminder: ${todayRem.title} at ${todayRem.time}`);
  if (d.openTasks.length && top.length < 3) top.push(`Open task: ${d.openTasks[0].title}`);
  if (d.nightCount && top.length < 3) top.push(`${d.nightCount} night thoughts need a morning look`);
  if (!top.length) {
    return { spoken: 'Nothing slipping through the cracks. You are genuinely on top of everything I can see.', top: [] };
  }
  return {
    spoken: `Top ${Math.min(3, top.length)} things you might be forgetting: ${top.slice(0, 3).join('. ')}.`,
    top: top.slice(0, 5),
  };
}

export interface RadarResult {
  spoken: string;
  overdue: Commitment[];
  upcoming: Commitment[];
}

export function followupRadar(commitments: Commitment[], now: Date = new Date()): RadarResult {
  const tk = todayKey(now);
  const open = commitments.filter((c) => !c.done);
  const overdue = open.filter((c) => c.dueKey && c.dueKey < tk);
  const upcoming = open.filter((c) => !c.dueKey || c.dueKey >= tk).slice(0, 5);
  const spoken = !open.length
    ? 'No open promises. Your word is clean!'
    : overdue.length
      ? `${overdue.length} promise${overdue.length === 1 ? ' is' : 's are'} overdue — starting with: ${overdue[0].text}. Handle it today?`
      : `You owe ${open.length} thing${open.length === 1 ? '' : 's'}: ${open.slice(0, 2).map((c) => c.text.slice(0, 60)).join('; ')}.`;
  return { spoken, overdue, upcoming };
}

const MONEY_RE = /(bill|emi|rent|recharge|renewal|renew|premium|fees|fee|loan|udhaar|udhar|dena hai|payment|netflix|jio|airtel|vi |electricity|bijli|gas|cylinder|lpg|school|college|sip|insurance|bima)/i;

/** Extract money-dues from reminders + saved items mentioning bills. */
export function moneyDue(
  reminders: { title: string; time: string; date?: string }[],
  items: { title: string; body?: string; due?: string; kind: string; status: string }[],
): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = [];
  for (const r of reminders) {
    if (MONEY_RE.test(r.title)) out.push({ title: r.title, detail: r.date ? `${r.date} ${r.time}` : `daily ${r.time}` });
  }
  for (const i of items) {
    if (i.status !== 'active') continue;
    if (i.kind === 'expense' && i.due) {
      out.push({ title: i.title, detail: `due ${i.due.slice(0, 10)}` });
    } else if (MONEY_RE.test(`${i.title} ${i.body || ''}`)) {
      out.push({ title: i.title, detail: i.due ? `due ${i.due.slice(0, 10)}` : 'no date set' });
    }
  }
  return out.slice(0, 10);
}
