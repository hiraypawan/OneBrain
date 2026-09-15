// Time-travel memory: natural date references ("last Tuesday", "pichle
// hafte", "kal") resolved against real calendar days, plus conversational
// summaries over messages + saved records. Pure + tested. No inference of
// identity or external facts — only the user's own stored history.

export interface DateRange {
  start: number; // inclusive ms
  end: number; // exclusive ms
  label: string; // spoken label, e.g. "Tuesday 9 September"
  key: string; // day key or range key
}

function dayStart(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtDay(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, ravivaar: 0, ravivar: 0, itvaar: 0, itvar: 0,
  monday: 1, somvar: 1, somvaar: 1,
  tuesday: 2, mangalvar: 2, mangalvaar: 2, mangal: 2,
  wednesday: 3, budhvar: 3, budhvaar: 3, budh: 3,
  thursday: 4, guruwar: 4, guruvar: 4, brihaspati: 4, virvaar: 4,
  friday: 5, shukravar: 5, shukravaar: 5, shukra: 5,
  saturday: 6, shanivar: 6, shanivaar: 6, shani: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8,
  oct: 9, nov: 10, dec: 11,
};

/**
 * Resolve a date reference in free text. pastBias=true treats "kal" as
 * yesterday (recall); false treats it as tomorrow (planning).
 */
export function parseDateRef(
  text: string,
  now: Date = new Date(),
  pastBias = true,
): DateRange | null {
  const t = ` ${String(text || '').toLowerCase()} `;
  const today = dayStart(now);
  const DAY = 86400000;
  const mk = (s: Date, e: Date, label: string, key: string): DateRange => ({
    start: s.getTime(),
    end: e.getTime(),
    label,
    key,
  });
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;

  // Explicit DD Month / DD/MM
  const md = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/);
  if (md) {
    const d = new Date(now.getFullYear(), MONTHS[md[2]], Number(md[1]));
    if (pastBias && d > today) d.setFullYear(d.getFullYear() - 1);
    if (!pastBias && d < today) d.setFullYear(d.getFullYear() + 1);
    return mk(dayStart(d), new Date(dayStart(d).getTime() + DAY), fmtDay(d), dayKey(d));
  }
  const slash = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const year = slash[3]
      ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])
      : now.getFullYear();
    const d = new Date(year, Number(slash[2]) - 1, Number(slash[1]));
    if (!Number.isNaN(d.getTime())) {
      const s = dayStart(d);
      return mk(s, new Date(s.getTime() + DAY), fmtDay(d), dayKey(d));
    }
  }

  // Relative days
  if (/\b(today|aaj)\b/.test(t)) {
    return mk(today, new Date(today.getTime() + DAY), `today, ${fmtDay(today)}`, dayKey(today));
  }
  if (/\b(day before yesterday|parso)\b/.test(t) && pastBias) {
    const d = new Date(today.getTime() - 2 * DAY);
    return mk(d, new Date(d.getTime() + DAY), fmtDay(d), dayKey(d));
  }
  if (/\b(yesterday|kal)\b/.test(t)) {
    const d = new Date(today.getTime() + (pastBias ? -DAY : DAY));
    return mk(dayStart(d), new Date(dayStart(d).getTime() + DAY), fmtDay(d), dayKey(d));
  }
  if (/\btomorrow\b/.test(t) && !pastBias) {
    const d = new Date(today.getTime() + DAY);
    return mk(dayStart(d), new Date(dayStart(d).getTime() + DAY), fmtDay(d), dayKey(d));
  }

  // Weeks / months
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  if (/\b(this week|my week|is hafte|iss hafte)\b/.test(t)) {
    const e = new Date(today.getTime() + DAY);
    return mk(weekStart, e, 'this week', `${dayKey(weekStart)}..${dayKey(today)}`);
  }
  if (/\b(last week|pichle hafte|pichhle hafte|guzra hafta)\b/.test(t)) {
    const s = new Date(weekStart.getTime() - 7 * DAY);
    return mk(s, weekStart, 'last week', `${dayKey(s)}..${dayKey(new Date(weekStart.getTime() - DAY))}`);
  }
  if (/\b(this month|my month|is mahine)\b/.test(t)) {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    const e = new Date(today.getTime() + DAY);
    return mk(s, e, 'this month', `${dayKey(s)}..${dayKey(today)}`);
  }
  if (/\b(last month|pichle mahine|pichhle mahine)\b/.test(t)) {
    const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const e = new Date(today.getFullYear(), today.getMonth(), 1);
    return mk(s, e, 'last month', `${dayKey(s)}..${dayKey(new Date(e.getTime() - DAY))}`);
  }

  // Weekday names ("last Tuesday", "mangalvar ko")
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    const re = new RegExp(`\\b(last\\s+|pichle\\s+|pichhle\\s+|ko\\s+)?${name}\\b`);
    const m = t.match(re);
    if (!m) continue;
    const wantsLast = /last|pichle|pichhle/.test(m[1] || '');
    const d = new Date(today);
    if (pastBias || wantsLast) {
      let delta = (today.getDay() - dow + 7) % 7;
      if (delta === 0) delta = 7; // "Tuesday" today -> last Tuesday
      if (wantsLast && delta < 7 && delta === (today.getDay() - dow + 7) % 7 && (today.getDay() - dow + 7) % 7 !== 0) {
        // "last Tuesday" when Tuesday already passed this week: keep it.
      } else if (wantsLast && (today.getDay() - dow + 7) % 7 === 0) {
        delta = 7;
      }
      d.setDate(d.getDate() - delta);
    } else {
      let delta = (dow - today.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
    }
    const s = dayStart(d);
    return mk(s, new Date(s.getTime() + DAY), fmtDay(d), dayKey(d));
  }
  return null;
}

export type RecallIntent =
  | 'day'
  | 'week'
  | 'month'
  | 'when'
  | 'lastAsked'
  | 'decisions'
  | null;

/** Is this a memory-recall question (vs a fresh question for the AI)? */
export function detectRecallIntent(text: string): RecallIntent {
  const t = String(text || '').toLowerCase();
  if (/(summarize|summary|recap) (my )?(week|hafta)/.test(t) || /(last week|pichle hafte).*(kya|what|summary|recap)/.test(t))
    return 'week';
  if (/(summarize|summary|recap) (my )?(month|mahina)/.test(t) || /(last month|pichle mahine).*(kya|what|summary)/.test(t))
    return 'month';
  if (/(what did (i|we) (decide|agree)|hamne kya (decide|tay|faisla)|decisions? (did|have) (i|we)|faisla kya)/.test(t))
    return 'decisions';
  if (/^(what did i|maine kya).*(ask|poo?cha|say|kaha)/.test(t)) return 'lastAsked';
  if (/(when did i|kab (maine|hamne)|i asked|maine (kya )?poo?cha|last.*(tuesday|monday|wednesday|thursday|friday|saturday|sunday|somvar|mangalvar|budhvar|guruwar|shukravar|shanivar|ravivaar)|yesterday.*(kya|what|poo?cha|ask)|kal maine)/.test(t))
    return 'day';
  return null;
}

export interface HistoryEntry {
  role: string;
  content: string;
  createdAt: number;
}

export interface SavedEntry {
  kind: string;
  title: string;
  body?: string;
  status?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface RangeSummary {
  spoken: string;
  bullets: string[];
  asked: string[];
  decisions: string[];
  done: string[];
  empty: boolean;
}

export function formatCitation(ts: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts));
}

/** Summarize what the user said/saved inside a range. Honest when empty. */
export function summarizeRange(
  messages: HistoryEntry[],
  saved: SavedEntry[],
  range: DateRange,
): RangeSummary {
  const inRange = messages.filter(
    (m) => m.createdAt >= range.start && m.createdAt < range.end,
  );
  const asked = inRange
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .filter((c) => c.trim().length > 1)
    .slice(-8);
  const savedIn = saved.filter(
    (s) => s.createdAt >= range.start && s.createdAt < range.end,
  );
  const decisions = savedIn
    .filter((s) => s.kind === 'decision')
    .map((s) => s.title);
  const done = savedIn
    .filter(
      (s) =>
        s.kind === 'task' &&
        s.status === 'done' &&
        (s.updatedAt || s.createdAt) >= range.start &&
        (s.updatedAt || s.createdAt) < range.end,
    )
    .map((s) => s.title);
  const empty = !asked.length && !savedIn.length && !done.length;
  const bullets: string[] = [];
  if (asked.length) bullets.push(`You asked ${asked.length} thing${asked.length === 1 ? '' : 's'}: ${asked.slice(-3).map((a) => `“${a.slice(0, 80)}”`).join('; ')}.`);
  if (decisions.length) bullets.push(`Decisions: ${decisions.slice(0, 3).join('; ')}.`);
  if (done.length) bullets.push(`Finished: ${done.slice(0, 3).join('; ')}.`);
  const spoken = empty
    ? `I don't have anything from ${range.label}. Nothing was said or saved then — at least not where I can see.`
    : `On ${range.label}: ${asked.length ? `you asked about ${asked.slice(-2).map((a) => a.slice(0, 60)).join(' and ')}. ` : ''}${decisions.length ? `You recorded ${decisions.length} decision${decisions.length === 1 ? '' : 's'}. ` : ''}${done.length ? `You finished ${done.length} task${done.length === 1 ? '' : 's'}.` : ''}`.trim();
  return { spoken, bullets, asked, decisions, done, empty };
}
