import type { Reminder } from './types';

export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Which reminders should fire right now? Daily ones fire once per day when
// their HH:MM passes; one-time ones (with date) fire once, ever.
export function dueReminders(list: Reminder[], now: Date = new Date()): Reminder[] {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = localDayKey(now);
  return (list || []).filter((r) => {
    if (!r.active || !r.time) return false;
    const at = toMinutes(r.time);
    if (at == null) return false;
    if (r.date) {
      if (r.lastFired === 'done') return false;
      const fireAt = new Date(`${r.date}T${r.time}:00`);
      if (Number.isNaN(fireAt.getTime())) return false;
      return fireAt.getTime() <= now.getTime();
    }
    if (r.lastFired === today) return false;
    return nowMin >= at;
  });
}

export function markFired(r: Reminder, now: Date = new Date()): Partial<Reminder> {
  if (r.date) return { active: false, lastFired: 'done' };
  return { lastFired: localDayKey(now) };
}

export interface ReminderIntent {
  title: string;
  time: string; // HH:MM
  date?: string; // YYYY-MM-DD for one-time
}

const REMIND_RE = /(remind me|remind|yaad dila|yaad dilao|yaad dilana)\b/i;

function pad2(n: number): string {
  return `${n}`.padStart(2, '0');
}

function hhmm(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function dayKey(d: Date): string {
  return localDayKey(d);
}

// "remind me to call mom at 6pm" / "mujhe dawai yaad dilao subah 9 baje" /
// "remind me in 10 minutes" -> { title, time, date? }. Null when the text
// is not a reminder request at all.
export function parseReminderIntent(text: string, now: Date = new Date()): ReminderIntent | null {
  const t = String(text || '');
  if (!REMIND_RE.test(t)) return null;
  const lower = t.toLowerCase();

  // Relative: "in 10 minutes", "2 ghante me", "10 min me"
  const rel =
    lower.match(/in\s+(\d+)\s*(min|mins|minutes?|hours?|hrs?)/) ||
    lower.match(/(\d+)\s*(min|minute|ghanta|ghante|hour|hours)\s*(me|mein|later)?/);
  if (rel) {
    const n = Number(rel[1]);
    if (n > 0 && n < 24 * 60) {
      const mins = /hour|hr|ghanta/.test(rel[2]) ? n * 60 : n;
      const at = new Date(now.getTime() + mins * 60000);
      const intent: ReminderIntent = { title: stripRemindPrefix(t), time: hhmm(at) };
      if (dayKey(at) !== dayKey(now)) intent.date = dayKey(at);
      return intent;
    }
  }

  // Absolute: "6pm", "18:30", "9 baje", "subah 9 baje", "kal 9 baje"
  const tm = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!tm) return null;
  let h = Number(tm[1]);
  const min = tm[2] ? Number(tm[2]) : 0;
  if (h > 23 || min > 59) return null;
  const ampm = tm[3];
  const period = /subah|morning/.test(lower) ? 'morning'
    : /dopahar|dopaher|afternoon/.test(lower) ? 'afternoon'
    : /shaam|sham|evening/.test(lower) ? 'evening'
    : /raat|rat|night/.test(lower) ? 'night' : null;
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (!ampm && period) {
    if (period === 'night' && h === 12) h = 0;
    else if (period !== 'morning' && h < 12) h += 12;
  }
  const intent: ReminderIntent = { title: stripRemindPrefix(t), time: `${pad2(h)}:${pad2(min)}` };
  if (/kal|tomorrow/.test(lower)) {
    const tom = new Date(now.getTime() + 86400000);
    intent.date = dayKey(tom);
  }
  return intent;
}

function stripRemindPrefix(t: string): string {
  let s = String(t || '');
  s = s.replace(/(please\s+)?(remind me|remind|yaad dilana|yaad dilao|yaad dila)\s*(to|ko|ke liye)?\s*/i, '');
  s = s.replace(/\s*(at|on|par|ko|ke liye)\s+\d.*$/i, '');
  s = s.replace(/\s*\d{1,2}(:\d{2})?\s*(am|pm|baje)?\s*$/i, '');
  s = s.replace(/^\s*(subah|morning|dopahar|afternoon|shaam|evening|raat|night|kal|tomorrow)\s+/gi, '');
  s = s.replace(/^\s*(mujhe|mere|mujhko|mujhse|please)\s+/gi, '');
  s = s.replace(/\s+(subah|morning|dopahar|afternoon|shaam|evening|raat|night|kal|tomorrow)\s*$/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return 'Reminder';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function fireReminderNotification(title: string, body: string): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await (reg as any).showNotification(title, {
          body,
          icon: '/icon-192.png',
          tag: `reminder-${Date.now()}`,
          requireInteraction: true,
        });
        return true;
      } catch {}
    }
    new Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}
