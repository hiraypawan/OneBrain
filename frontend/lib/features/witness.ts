// Witness / safety mode: continuous timestamped transcription + periodic
// check-ins + missed-check-in alert with evidence export. Pure state
// reducer + formatters; the React runner owns timers and speech.
// Free forever — safety is trust infrastructure, not a paywall item.

export type WitnessPhase = 'idle' | 'active' | 'alert';

export interface WitnessLogEntry {
  at: number;
  kind: 'transcript' | 'event';
  text: string;
}

export interface WitnessState {
  phase: WitnessPhase;
  startedAt: number | null;
  lastCheckinAt: number | null;
  misses: number;
  intervalSec: number;
  contactName: string | null;
  contactPhone: string | null;
  log: WitnessLogEntry[];
}

export const INITIAL_WITNESS: WitnessState = {
  phase: 'idle',
  startedAt: null,
  lastCheckinAt: null,
  misses: 0,
  intervalSec: 180,
  contactName: null,
  contactPhone: null,
  log: [],
};

export type WitnessAction =
  | { type: 'start'; at: number; intervalSec?: number }
  | { type: 'stop' }
  | { type: 'log'; at: number; text: string }
  | { type: 'checkin-due'; at: number }
  | { type: 'responded'; at: number }
  | { type: 'missed'; at: number }
  | { type: 'set-contact'; name: string | null; phone: string | null };

export const MAX_MISSES = 2;

const ev = (at: number, text: string): WitnessLogEntry => ({ at, kind: 'event', text });
const tx = (at: number, text: string): WitnessLogEntry => ({ at, kind: 'transcript', text });

export function witnessReducer(s: WitnessState, a: WitnessAction): WitnessState {
  switch (a.type) {
    case 'start':
      return {
        ...INITIAL_WITNESS,
        phase: 'active',
        startedAt: a.at,
        lastCheckinAt: a.at,
        intervalSec: a.intervalSec || s.intervalSec || 180,
        contactName: s.contactName,
        contactPhone: s.contactPhone,
        log: [ev(a.at, 'Witness mode started.')],
      };
    case 'stop':
      return { ...s, phase: 'idle', startedAt: null, misses: 0 };
    case 'log':
      if (s.phase !== 'active') return s;
      return { ...s, log: [...s.log, tx(a.at, a.text)].slice(-500) };
    case 'checkin-due':
      if (s.phase !== 'active') return s;
      return { ...s, log: [...s.log, ev(a.at, 'Check-in asked: “Sab theek? Bolo safe.”')].slice(-500) };
    case 'responded':
      if (s.phase === 'idle') return s;
      return {
        ...s,
        phase: 'active',
        misses: 0,
        lastCheckinAt: a.at,
        log: [...s.log, ev(a.at, 'User responded: safe.')].slice(-500),
      };
    case 'missed': {
      if (s.phase !== 'active') return s;
      const misses = s.misses + 1;
      const alert = misses >= MAX_MISSES;
      return {
        ...s,
        misses,
        phase: alert ? 'alert' : 'active',
        log: [...s.log, ev(a.at, alert ? 'No response twice — ALERT raised.' : `Check-in missed (${misses}).`)].slice(-500),
      };
    }
    case 'set-contact':
      return { ...s, contactName: a.name, contactPhone: a.phone };
  }
}

export type WitnessIntent =
  | { action: 'start'; intervalSec?: number }
  | { action: 'stop' }
  | { action: 'safe' }
  | { action: 'contact'; name: string; phone?: string }
  | null;

export function detectWitnessIntent(text: string): WitnessIntent {
  const t = String(text || '').trim();
  const low = t.toLowerCase();
  if (/^(stop witness|witness (mode )?(band|off|stop|exit|khatam)|(band karo|stop) (witness|gawah)|safety mode (off|stop|band|khatam)|stop safety mode)$/.test(low))
    return { action: 'stop' };
  if (/^(safe|main safe|main theek|theek hun|sab theek|ok safe|i am safe|i'm safe)\.?$/.test(low))
    return { action: 'safe' };
  const contact = t.match(/(?:witness|emergency) contact\s+([a-zA-Z]+(?: +[a-zA-Z]+)*)(?:\s+(\+?[\d][\d ]{9,14}))?/i) ||
    low.match(/(?:mera )?emergency contact (?:hai )?([a-z]+)(?:\s+(\+?[\d ]{10,15}))?/);
  if (contact) {
    return { action: 'contact', name: contact[1].trim(), phone: contact[2]?.replace(/\s+/g, '') };
  }
  if (/(witness mode|gawah mode|nigrani|safety mode|protect me|mujhe (track|watch) karo|akeli hun|akela hun)/.test(low)) {
    const mins = low.match(/(\d+)\s*(min|minute)/);
    return { action: 'start', intervalSec: mins ? Math.min(30, Math.max(1, Number(mins[1]))) * 60 : undefined };
  }
  return null;
}

export function evidenceText(s: WitnessState): string {
  const lines = s.log.map((e) => {
    const ts = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    }).format(new Date(e.at));
    return `[${ts}] ${e.kind === 'event' ? '•' : '“'}${e.text}${e.kind === 'event' ? '' : '”'}`;
  });
  const started = s.startedAt ? new Date(s.startedAt).toLocaleString('en-IN') : 'unknown';
  return `OneBrain Witness Log — started ${started}\nMissed check-ins: ${s.misses}\n\n${lines.join('\n')}\n\n— Recorded on-device by OneBrain witness mode.`;
}

/** sms: deep-link to alert the trusted contact. */
export function smsHref(phone: string | null, state: WitnessState): string {
  const last = [...state.log].reverse().find((e) => e.kind === 'transcript')?.text || 'no recent speech';
  const body = `OneBrain SAFETY ALERT: I may need help. My assistant missed my check-ins. Last heard: "${last.slice(0, 100)}". Please call me.`;
  const p = (phone || '').replace(/\s+/g, '');
  return `sms:${p}?body=${encodeURIComponent(body)}`;
}
