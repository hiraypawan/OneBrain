// Dream/thought dumping: frictionless late-night voice notes -> morning
// insight digest. Night capture never interrogates (no slot-fill at 2am);
// the morning digest reframes worries and converts ideas to task drafts.
// Includes distress detection with supportive response + helpline.

export type NightTag = 'worry' | 'idea' | 'gratitude' | 'dream' | 'plan' | 'vent';

export interface NightNote {
  id: string;
  text: string;
  at: number;
  tags: NightTag[];
}

const TAG_RES: { tag: NightTag; re: RegExp }[] = [
  { tag: 'worry', re: /(tension|tenshan|worry|worried|darr|dar lag|fear|anxiety|ghabrahat|neend nahi|stress|pareshan|presentation|exam|interview|kal (ka|ki) fikar)/i },
  { tag: 'idea', re: /(idea|socha|khayal|plan hai|kar sakte|startup|business|likhna hai|banana hai)/i },
  { tag: 'gratitude', re: /(shukr|shukriya|thankful|grateful|achha (laga|din)|khush|blessed)/i },
  { tag: 'dream', re: /(sapna|sapne|dream|khwab|neend mein)/i },
  { tag: 'plan', re: /(kal (karna|karunga|karungi|jana|karna hai)|subah|tomorrow|to-?do|yaad rakhna)/i },
  { tag: 'vent', re: /(gussa|angry|naraz|rona|ro (pad|raha)|sad|dukhi|rona aa|frustrat|tang aa)/i },
];

export function classifyNightNote(text: string): NightTag[] {
  const tags = TAG_RES.filter((t) => t.re.test(text)).map((t) => t.tag);
  return tags.length ? [...new Set(tags)].slice(0, 3) : ['vent'];
}

export function detectNightIntent(text: string): boolean {
  return /^(night note|raat note|raat-note|sapna|sone se pehle|2 ?am|late night)[:\s]/i.test(String(text || '').trim()) ||
    /(night note|raat ko yaad|neend nahi aa rahi|sone se pehle (note|likh))/i.test(String(text || ''));
}

/** Late-night hours get the dim, no-questions capture treatment. */
export function isNightHour(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h >= 21 || h < 5;
}

// Self-harm / crisis language (EN + Roman Hindi). Supportive, never clinical.
const DISTRESS_RE = /(suicide|khudkushi|khud khushi|kill myself|end my life|marna chahta|marna chahti|mar jana|jeene ka mann nahi|jeena nahi|no reason to live|self[\s-]?harm|khud ko nuksan)/i;

export function distressCheck(text: string): boolean {
  return DISTRESS_RE.test(String(text || ''));
}

export const SUPPORTIVE_REPLY =
  'Sunno — tum akele nahi ho, aur yeh raat guzar jayegi. ' +
  'Main AI hun, counselor nahi, isliye please kisi bharosemand se baat karo. ' +
  'India mein muft madad: teleMANAS 14416 (24x7), ya iCall 9152987821 subah 8 se raat 10 tak. ' +
  'Agar abhi khatra lag raha hai to turant 112 par call karo. ' +
  'Maine tumhara note save kar liya hai — subah hum is par baat karenge.';

export interface MorningDigest {
  spoken: string;
  reframes: { note: string; reframe: string }[];
  taskDrafts: string[];
  gratitudes: string[];
  empty: boolean;
}

function reframeWorry(text: string): string {
  const t = text.toLowerCase();
  if (/(presentation|meeting|interview)/.test(t))
    return 'Break it into 3 slides/points and rehearse once out loud — preparation beats worry.';
  if (/(exam|paper|padhai|study)/.test(t))
    return 'Study the single highest-weight topic first for 45 minutes — momentum beats all-night panic.';
  if (/(money|paise|bill|loan|emi)/.test(t))
    return 'Write the exact number down and one call/message that moves it — vague money-fear shrinks on paper.';
  if (/(health|tabiyat|bimar)/.test(t))
    return 'Book the checkup/message the doctor today — health worry is your body asking for one appointment.';
  return 'Name the smallest first step and do only that before 11am — action dissolves 2am worry.';
}

/** Compile last night's notes into a morning digest. Pure. */
export function compileMorningDigest(notes: NightNote[]): MorningDigest {
  if (!notes.length) {
    return {
      spoken: 'No night notes from last night. Sleep well, wake up fresh!',
      reframes: [], taskDrafts: [], gratitudes: [], empty: true,
    };
  }
  const reframes = notes
    .filter((n) => n.tags.includes('worry') || n.tags.includes('vent'))
    .map((n) => ({ note: n.text, reframe: reframeWorry(n.text) }));
  const taskDrafts = notes
    .filter((n) => n.tags.includes('idea') || n.tags.includes('plan'))
    .map((n) => n.text.slice(0, 120));
  const gratitudes = notes
    .filter((n) => n.tags.includes('gratitude'))
    .map((n) => n.text.slice(0, 120));
  const parts = [`Last night you shared ${notes.length} thought${notes.length === 1 ? '' : 's'}.`];
  if (reframes.length) parts.push(`${reframes.length} worr${reframes.length === 1 ? 'y' : 'ies'} — I reframed each into one small step.`);
  if (taskDrafts.length) parts.push(`${taskDrafts.length} idea${taskDrafts.length === 1 ? '' : 's'} waiting as task drafts — say the word and I'll save them.`);
  if (gratitudes.length) parts.push('And you ended with gratitude. Hold onto that.');
  return { spoken: parts.join(' '), reframes, taskDrafts, gratitudes, empty: false };
}

/** Notes from "last night" (yesterday 21:00 -> today 05:00, or explicit). */
export function lastNightWindow(now: Date = new Date()): { start: number; end: number } {
  const end = new Date(now);
  end.setHours(5, 0, 0, 0);
  if (now.getHours() >= 5 && now.getHours() < 21) {
    // Morning/afternoon: last night = previous evening -> this morning.
  } else if (now.getHours() >= 21) {
    end.setDate(end.getDate() + 1);
  }
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  start.setHours(21, 0, 0, 0);
  return { start: start.getTime(), end: end.getTime() };
}
