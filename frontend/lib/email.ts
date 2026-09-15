// Voice email drafter: intent -> conversational slot-fill -> structured draft
// -> copy + mailto: deep-link (opens Gmail app pre-filled, zero OAuth).
// Pure + tested. Never sends anything itself; mailto: keeps the user as the
// sender, matching the approval policy.

import { findNumber } from './numbers';
import { parseDateRef } from './timetravel';

export type EmailTone = 'formal' | 'friendly' | 'hinglish';
export type EmailKind = 'leave' | 'sick-leave' | 'generic' | 'followup' | 'thanks' | 'resignation';

export interface EmailSlots {
  kind: EmailKind;
  to?: string;
  toEmail?: string;
  days?: number;
  fromDate?: string; // ISO
  reason?: string;
  context?: string; // free-form purpose for generic mails
  tone: EmailTone;
  userName?: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
  tone: EmailTone;
  kind: EmailKind;
  to?: string;
  toEmail?: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function detectEmailIntent(text: string): EmailKind | null {
  const t = String(text || '').toLowerCase();
  if (!/(mail|email|e-mail|application|application likh|chutti|leave|letter|resign|istifa)/.test(t)) return null;
  if (/(resign|istifa|notice period)/.test(t)) return 'resignation';
  if (/(sick|bimar|bimari|fever|bukhar|doctor|hospital|tabiyat)/.test(t) && /(leave|chutti|application)/.test(t))
    return 'sick-leave';
  if (/(leave|chutti|absent|day off|days? off)/.test(t)) return 'leave';
  if (/(follow.?up|reminder mail|yaad dilane|status (mail|email|poochna)|update (maang|mangna|chahiye))/i.test(t)) return 'followup';
  if (/(thank|shukriya|dhanyavad|appreciation)/.test(t)) return 'thanks';
  if (/(likh ?do|likho|draft|bana ?do|compose|send|bhej)/.test(t)) return 'generic';
  return null;
}

/** Pull whatever slots are already present in the first utterance. */
export function extractEmailSlots(text: string, now: Date = new Date()): Partial<EmailSlots> {
  const out: Partial<EmailSlots> = {};
  const t = String(text || '');
  const email = t.match(EMAIL_RE);
  if (email) out.toEmail = email[0];
  const toName = t.match(/\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    t.match(/(?:ko|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    t.match(/\b(manager|sir|madam|boss|hr|principal|teacher)\b/i);
  if (toName && !out.toEmail) out.to = capitalizeName(toName[1]);
  const n = findNumber(t);
  if (n && Number.isInteger(n.value) && n.value > 0 && n.value <= 60) {
    // The number must sit next to a day-word: "3 din", "do din ki", "5 days".
    // Bare "likh do" (= "write!") must NOT become 2 days.
    const at = n.index >= 0 ? n.index : t.toLowerCase().indexOf(n.raw.toLowerCase());
    const near = at >= 0 ? t.slice(Math.max(0, at - 14), at + n.raw.length + 14) : t;
    if (/(days?|din|dinon|chutti)/i.test(near)) out.days = n.value;
  }
  const range = parseDateRef(t, now, false);
  if (range && range.key.length === 10) out.fromDate = new Date(range.start).toISOString();
  const reason =
    /(sick|bimar|bimari|fever|bukhar|tabiyat|health)/i.test(t) ? 'health'
    : /(family|ghar|parivar|relative|shaadi|marriage|wedding|function)/i.test(t) ? 'family function'
    : /(travel|trip|gaon|village|out of station|bahar)/i.test(t) ? 'travel'
    : /(personal|urgent|kaam|work)/i.test(t) ? 'personal work'
    : /(exam|paper|study|padhai)/i.test(t) ? 'exams'
    : undefined;
  if (reason) out.reason = reason;
  return out;
}

function capitalizeName(s: string): string {
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

export type SlotName = 'to' | 'days' | 'fromDate' | 'reason' | 'context';

export function missingSlots(slots: EmailSlots): SlotName[] {
  const miss: SlotName[] = [];
  if (slots.kind === 'leave' || slots.kind === 'sick-leave') {
    if (!slots.to && !slots.toEmail) miss.push('to');
    if (!slots.days) miss.push('days');
    if (!slots.fromDate) miss.push('fromDate');
    if (!slots.reason) miss.push('reason');
  } else {
    if (!slots.to && !slots.toEmail) miss.push('to');
    if (!slots.context && !slots.reason) miss.push('context');
  }
  return miss;
}

export function slotQuestion(slot: SlotName, kind: EmailKind): string {
  switch (slot) {
    case 'to':
      return kind === 'leave' || kind === 'sick-leave'
        ? 'Kisko bhejna hai — manager, HR, ya teacher? Naam bolo.'
        : 'Kisko bhejna hai? Naam ya email bolo.';
    case 'days':
      return 'Kitne din ki chhutti chahiye?';
    case 'fromDate':
      return 'Kab se — kal se, ya koi date bolo?';
    case 'reason':
      return 'Wajah kya likhun — tabiyat, family function, ya personal kaam?';
    case 'context':
      return 'Mail kis baare mein hai — ek line mein batao?';
  }
}

/** Parse one slot-fill answer into slots. Returns null when unparseable. */
export function fillSlotFromAnswer(
  slot: SlotName,
  answer: string,
  now: Date = new Date(),
): Partial<EmailSlots> | null {
  const t = String(answer || '').trim();
  if (!t) return null;
  if (slot === 'to') {
    const email = t.match(EMAIL_RE);
    if (email) return { toEmail: email[0] };
    let words = t.split(/\s+/);
    while (words.length > 1 && /^(to|ko|for|my|mere|meri|apne)$/i.test(words[0])) words.shift();
    while (words.length > 1 && /^(ko|to|sir|madam)$/i.test(words[words.length - 1])) words.pop();
    // Role word + name ("mere manager Ramesh") -> keep just the name.
    if (words.length > 1 && /^(manager|boss|supervisor)$/i.test(words[0])) words.shift();
    const name = words.join(' ');
    if (name.length < 2 || name.length > 60) return null;
    return { to: capitalizeName(name) };
  }
  if (slot === 'days') {
    const n = findNumber(t);
    if (n && Number.isInteger(n.value) && n.value > 0 && n.value <= 60) return { days: n.value };
    return null;
  }
  if (slot === 'fromDate') {
    const range = parseDateRef(t, now, false);
    if (range && range.key.length === 10) return { fromDate: new Date(range.start).toISOString() };
    return null;
  }
  if (slot === 'reason') {
    const r = extractEmailSlots(t, now).reason;
    return { reason: r || t.slice(0, 120) };
  }
  // context
  if (t.length < 3) return null;
  return { context: t.slice(0, 400) };
}

function fmtRange(fromIso: string, days: number): string {
  const from = new Date(fromIso);
  const to = new Date(from.getTime() + (days - 1) * 86400000);
  const f = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
  return days <= 1 ? f(from) : `${f(from)} – ${f(to)}`;
}

const REASON_LINE: Record<string, string> = {
  health: 'I have been unwell and my doctor has advised rest',
  'family function': 'there is an important family function I must attend',
  travel: 'I have to travel out of station for urgent work',
  'personal work': 'I have some urgent personal work to attend to',
  exams: 'I have examinations scheduled',
};

export function buildDraft(slots: EmailSlots, userName = 'Your Name'): EmailDraft {
  const { kind, tone } = slots;
  const to = slots.to || (slots.toEmail ? slots.toEmail.split('@')[0] : 'Sir/Madam');
  if (kind === 'leave' || kind === 'sick-leave') {
    const days = slots.days || 1;
    const range = slots.fromDate ? fmtRange(slots.fromDate, days) : `${days} day${days === 1 ? '' : 's'}`;
    const reasonLine = REASON_LINE[slots.reason || ''] || `of ${slots.reason || 'an urgent matter'}`;
    const subject = kind === 'sick-leave'
      ? `Sick Leave Application — ${range}`
      : `Leave Application — ${days} day${days === 1 ? '' : 's'} (${range})`;
    const formalBody =
      `Respected ${to},\n\nI am writing to request leave for ${range} (${days} day${days === 1 ? '' : 's'}) as ${reasonLine}. I will ensure my pending work is handed over and will be reachable on phone for anything urgent.\n\nKindly grant me leave for the above dates. I shall be grateful.\n\nThanking you,\n${userName}`;
    const friendlyBody =
      `Hi ${to},\n\nI wanted to request leave for ${range} — ${reasonLine}. I'll wrap up anything pending before I go and stay reachable on phone if something urgent comes up.\n\nWould really appreciate your approval. Thanks!\n\nBest,\n${userName}`;
    const hinglishBody =
      `Namaste ${to},\n\nMujhe ${range} ko chhutti chahiye (${days} din) — ${reasonLine}. Pending kaam main pehle nipta dunga/dungi, aur urgent ho to phone par available rahunga/rahungi.\n\nPlease approve kar dijiye. Dhanyavad!\n\n${userName}`;
    return {
      subject,
      body: tone === 'friendly' ? friendlyBody : tone === 'hinglish' ? hinglishBody : formalBody,
      tone, kind, to: slots.to, toEmail: slots.toEmail,
    };
  }
  if (kind === 'resignation') {
    const subject = 'Resignation — Notice Period';
    const body =
      `Respected ${to},\n\nI am writing to formally resign from my position. My last working day will be as per the notice period in my appointment terms. I am grateful for the opportunities here and will do a complete handover of my responsibilities.\n\nThank you for your guidance.\n\nSincerely,\n${userName}`;
    return { subject, body, tone, kind, to: slots.to, toEmail: slots.toEmail };
  }
  const purpose = slots.context || slots.reason || 'the matter we discussed';
  if (kind === 'followup') {
    const subject = `Following up: ${purpose.slice(0, 60)}`;
    const body =
      tone === 'hinglish'
        ? `Namaste ${to},\n\n${purpose} — is par follow up kar raha/rahi hun. Koi update ho to please batayein.\n\nDhanyavad,\n${userName}`
        : tone === 'friendly'
          ? `Hi ${to},\n\nJust following up on ${purpose}. Let me know if there's any update, or anything you need from my side.\n\nThanks,\n${userName}`
          : `Respected ${to},\n\nThis is a kind follow-up regarding ${purpose}. I would be grateful for an update at your convenience.\n\nThanking you,\n${userName}`;
    return { subject, body, tone, kind, to: slots.to, toEmail: slots.toEmail };
  }
  if (kind === 'thanks') {
    const subject = `Thank you — ${purpose.slice(0, 50)}`;
    const body =
      tone === 'hinglish'
        ? `Namaste ${to},\n\n${purpose} ke liye dil se dhanyavad! Bahut madad mili.\n\n${userName}`
        : `Dear ${to},\n\nThank you very much for ${purpose}. I truly appreciate it.\n\nWarm regards,\n${userName}`;
    return { subject, body, tone, kind, to: slots.to, toEmail: slots.toEmail };
  }
  const subject = purpose.length > 60 ? `${purpose.slice(0, 57)}…` : purpose;
  const body =
    tone === 'hinglish'
      ? `Namaste ${to},\n\n${purpose}.\n\nDhanyavad,\n${userName}`
      : tone === 'friendly'
        ? `Hi ${to},\n\n${purpose}.\n\nBest,\n${userName}`
        : `Respected ${to},\n\n${purpose}.\n\nThanking you,\n${userName}`;
  return { subject, body, tone, kind, to: slots.to, toEmail: slots.toEmail };
}

export function retone(draft: EmailDraft, tone: EmailTone, slots: EmailSlots, userName?: string): EmailDraft {
  return buildDraft({ ...slots, tone }, userName);
}

/** Deep-link that opens the mail app pre-filled. Empty `to` still works. */
export function mailtoHref(draft: EmailDraft): string {
  const to = encodeURIComponent(draft.toEmail || '');
  return `mailto:${to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}

export function draftSpokenSummary(draft: EmailDraft): string {
  return `Draft ready — subject: ${draft.subject}. ${draft.to ? `To ${draft.to}. ` : ''}Review it on screen, change the tone if you like, then copy it or open your mail app. I never send mail by myself.`;
}
