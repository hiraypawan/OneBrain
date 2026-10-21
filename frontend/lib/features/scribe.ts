// Scribe summaries: meeting/lecture/doctor-visit capture -> structured
// minutes (decisions / owners / deadlines / open questions) + one-tap task
// drafts. Rule-based extraction works fully offline; the AI brain can
// polish wording when online.

export interface Minutes {
  decisions: string[];
  owners: { who: string; what: string }[];
  deadlines: { what: string; when: string }[];
  questions: string[];
  summary: string;
  sentenceCount: number;
}

export function detectScribeIntent(text: string): boolean {
  const t = String(text || '');
  return /^(scribe|minutes|meeting notes|meeting ki summary|iska (summary|minutes) bana|note karo meeting|summarize (this|that|the) (meeting|discussion|talk|lecture|call))\b/i.test(t.trim()) ||
    /(meeting|lecture|call|discussion).*(minutes|summary|notes) (banao|bana|do|likho)/i.test(t);
}

function sentences(text: string): string[] {
  return String(text || '')
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

const DECIDE_RE = /(decided|we decided|final|tai hua|tay hua|faisla|agreed|approved|manzoor|confirm ho gaya|pakka)/i;
const OWNER_RE = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(will|ko|should|ko karna|karega|karegi|le lega|le legi|dega|degi|bhejega|bhejegi)/;
const OWNER_RE2 = /(will be (done|handled|sent|prepared) by|zimmedari)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;
const DEADLINE_RE = /(by|tak|before|till|deadline)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|kal|parso|evening|morning|next week|hafte|\d{1,2}(?:\/\d{1,2})?)/i;

export function extractMinutes(text: string): Minutes {
  const list = sentences(text).slice(0, 60);
  const decisions: string[] = [];
  const owners: Minutes['owners'] = [];
  const deadlines: Minutes['deadlines'] = [];
  const questions: string[] = [];
  for (const s of list) {
    if (DECIDE_RE.test(s) && decisions.length < 8) decisions.push(s.slice(0, 160));
    const o = s.match(OWNER_RE) || s.match(OWNER_RE2);
    if (o && owners.length < 10) {
      const who = (o[3] || o[1] || '').trim();
      if (who.length >= 2 && who.length <= 40) owners.push({ who, what: s.slice(0, 140) });
    }
    const dl = s.match(DEADLINE_RE);
    if (dl && deadlines.length < 8) deadlines.push({ what: s.slice(0, 120), when: dl[0].slice(0, 40) });
    if (/\?\s*$/.test(s) && questions.length < 8) questions.push(s.slice(0, 160));
  }
  const summary = list.length
    ? `${list.length} points captured: ${decisions.length} decision${decisions.length === 1 ? '' : 's'}, ${owners.length} owner${owners.length === 1 ? '' : 's'}, ${deadlines.length} deadline${deadlines.length === 1 ? '' : 's'}.`
    : 'No clear points found — try speaking in short sentences.';
  return { decisions, owners, deadlines, questions, summary, sentenceCount: list.length };
}

/** Convert owners + deadlines into task-draft strings for one-tap saving. */
export function minutesToTasks(m: Minutes): string[] {
  const tasks: string[] = [];
  for (const o of m.owners) tasks.push(`${o.who}: ${o.what}`);
  for (const d of m.deadlines) {
    if (!tasks.some((t) => t.includes(d.what.slice(0, 30)))) tasks.push(`${d.what} (${d.when})`);
  }
  return tasks.slice(0, 10);
}

export function spokenMinutes(m: Minutes): string {
  if (!m.sentenceCount) return 'I could not hear enough to make minutes. Try again with short clear sentences.';
  const bits: string[] = [];
  if (m.decisions.length) bits.push(`${m.decisions.length} decisions, first: ${m.decisions[0].slice(0, 80)}`);
  if (m.owners.length) bits.push(`${m.owners.length} owners, first: ${m.owners[0].who}`);
  if (m.deadlines.length) bits.push(`${m.deadlines.length} deadlines`);
  if (m.questions.length) bits.push(`${m.questions.length} open questions`);
  return `Minutes ready. ${bits.join('; ') || 'Points captured'}. Full list is on screen — say "save scribe tasks" to create tasks.`;
}
