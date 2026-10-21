// Turns raw SpeechRecognition results into accepted utterances.
//
// Why this exists: Chrome on Android flags almost every result `isFinal`
// but reports `confidence: 0` for the provisional ones — and on a number of
// phones for EVERY result. A plain "drop finals below 0.3 confidence" gate
// therefore throws away everything the phone hears and the assistant never
// answers. Desktop Chrome reports real confidences (~0.7–0.95) and those are
// accepted immediately; zero/unknown confidences are held for a moment and
// accepted as soon as nothing better follows (or the session ends).
//
// Pure module: no DOM, no React, fully unit-tested.

export type ResultClass = 'interim' | 'noise' | 'hold' | 'accept';
export type PushOutcome = ResultClass | 'duplicate' | 'empty';

export interface RecognitionResultLike {
  isFinal: boolean;
  transcript: string;
  confidence?: unknown;
}

export interface CollectorOptions {
  onAccept: (text: string, confidence?: number) => void;
  /** How long a confidence-0 final waits for a better one. Default 1200 ms. */
  holdMs?: number;
  /** Identical finals inside this window are repeats, not new turns. Default 3000 ms. */
  dedupeMs?: number;
  /** Real (non-zero) confidences below this are treated as bleed/noise. Default 0.3. */
  minConfidence?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface FinalCollector {
  push(result: RecognitionResultLike): PushOutcome;
  /** Accept a held transcript right now (the recognizer ended). True if something was accepted. */
  flush(): boolean;
  /** Drop anything pending without accepting it. */
  reset(): void;
  pending(): string | null;
}

export function classifyResult(
  isFinal: boolean,
  confidence: unknown,
  minConfidence = 0.3,
): ResultClass {
  if (!isFinal) return 'interim';
  if (typeof confidence === 'number' && Number.isFinite(confidence) && confidence > 0) {
    return confidence < minConfidence ? 'noise' : 'accept';
  }
  // 0, undefined, NaN, negative: the engine did not score this result. Only a
  // follow-up result (or silence) tells us whether it was the real final.
  return 'hold';
}

export function normalizeTranscript(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** @deprecated Replaced by createUtteranceAssembler (whole turns across pauses). Kept for its tests; not used by the app. */
export function createFinalCollector(options: CollectorOptions): FinalCollector {
  const holdMs = options.holdMs ?? 1200;
  const dedupeMs = options.dedupeMs ?? 3000;
  const minConfidence = options.minConfidence ?? 0.3;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as any));

  let pendingText: string | null = null;
  let timer: unknown = null;
  let lastAccepted = { text: '', at: -Infinity };

  const cancelHold = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };

  const isRepeat = (text: string) =>
    normalizeTranscript(text) === lastAccepted.text && now() - lastAccepted.at < dedupeMs;

  const accept = (text: string, confidence?: number): boolean => {
    cancelHold();
    pendingText = null;
    if (isRepeat(text)) return false;
    lastAccepted = { text: normalizeTranscript(text), at: now() };
    options.onAccept(text.trim(), confidence);
    return true;
  };

  return {
    push(result) {
      const text = String(result.transcript || '');
      const kind = classifyResult(result.isFinal, result.confidence, minConfidence);
      if (kind === 'interim' || kind === 'noise') return kind;
      if (!text.trim()) return 'empty';
      if (kind === 'accept') {
        return accept(text, result.confidence as number) ? 'accept' : 'duplicate';
      }
      // hold: remember the newest wording and (re)start the grace timer.
      if (isRepeat(text)) return 'duplicate';
      pendingText = text;
      cancelHold();
      timer = setTimer(() => {
        timer = null;
        if (pendingText != null) accept(pendingText);
      }, holdMs);
      return 'hold';
    },
    flush() {
      if (pendingText == null) return false;
      return accept(pendingText);
    },
    reset() {
      cancelHold();
      pendingText = null;
    },
    pending() {
      return pendingText;
    },
  };
}

// ── Utterance assembler ────────────────────────────────────────────────
// The recognizer marks a result "final" at every short breath pause, so
// accepting the first final cut people off mid-sentence ("remind me to call
// mom" … [pause] … "tomorrow at 6" was lost). The assembler keeps every final
// segment of one turn and only hands the turn over once the PERSON has
// stopped — which is not the same thing as "no result arrived".
//
// Three things can make the mic go quiet that are not the person finishing:
//   1. a thinking pause in the middle of a sentence;
//   2. the engine restarting its session (Android Chrome ends the continuous
//      session after each phrase and the app starts a new one) — that gap is
//      silence the app caused, and counting it is what made the assistant
//      answer the first two words of a long request;
//   3. a dropped result while the person is still audibly talking.
// So the turn is held while (a) the recognizer is restarting, (b) the mic
// still carries voice energy, or (c) the last words cannot end a sentence.
// Every one of those holds is bounded, so a turn is never stuck.

export interface AssemblerOptions {
  onAccept: (text: string, confidence?: number) => void;
  /**
   * Quiet time after the last heard word before the turn is sent. Default
   * 1600 ms. Pass a function to read it live, so a room that changes while the
   * session is running changes the wait for the turns still to come.
   */
  silenceMs?: number | (() => number);
  /** Real (non-zero) confidences below this are bleed/noise. Default 0.3. */
  minConfidence?: number;
  /** Identical turns inside this window are repeats. Default 3000 ms. */
  dedupeMs?: number;
  /** Safety cap: a turn is sent after this long even if speech never pauses. Default 60 s. */
  maxTurnMs?: number;
  /** Extra wait when the last heard words cannot end a sentence. Default 1400 ms. */
  incompleteExtensionMs?: number;
  /** Hard ceiling for one wait (silence + extension). Default 3600 ms. */
  maxSilenceMs?: number;
  /** How long a restarting recognizer may hold a heard turn. Default 3000 ms. */
  pausedGraceMs?: number;
  /** Voice-activity probe: true while the mic still carries speech energy. */
  speechActive?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface UtteranceAssembler extends FinalCollector {
  /** Committed words plus what is being heard right now (for the live caption). */
  preview(): string;
  /** Send whatever has been heard immediately ("Send now"). */
  sendNow(): boolean;
  /**
   * The recognizer is not listening right now (session ended, restarting).
   * Quiet time from here on is not the person's silence and must not end the
   * turn — until pausedGraceMs passes and nothing came back.
   */
  pause(): void;
  /** The recognizer is listening again: normal end-of-speech timing resumes. */
  resume(): void;
  /** True between pause() and resume(). */
  isPaused(): boolean;
  /** How long this turn waits if nothing more is heard, in ms. */
  waitMs(): number;
}

export const SILENCE_MS_DEFAULT = 1600;
export const SILENCE_MS_MIN = 700;
export const SILENCE_MS_MAX = 4000;
/** Extra grace for a sentence that is obviously not finished. */
export const INCOMPLETE_EXTENSION_MS_DEFAULT = 1400;
/** No single wait ever grows past this, however unfinished the words look. */
export const MAX_SILENCE_MS_DEFAULT = 3600;
/** A restarting recognizer gets this long before its held turn is delivered. */
export const PAUSED_GRACE_MS_DEFAULT = 3000;
/** How often a held turn re-checks "is the person still talking?". */
export const VOICE_POLL_MS = 200;

export function clampSilenceMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SILENCE_MS_DEFAULT;
  return Math.min(SILENCE_MS_MAX, Math.max(SILENCE_MS_MIN, Math.round(n)));
}

// ── Is the sentence finished? ──────────────────────────────────────────
// Words that cannot end a sentence in English, Hinglish, Hindi (Roman) or
// Marathi (Roman). If a turn's last word is one of these, the person is
// almost certainly still talking, so the wait is extended instead of sending
// "remind me to call the bank and" as if it were the whole request.
//
// Deliberately NOT in this list: words that routinely end a finished Hindi
// sentence ("hai", "karo", "batao", "chahiye", "do", "kya"), because holding
// those would add latency to the most common short turns of all.
const DANGLING_WORDS = new Set([
  // English: connectives
  'and', 'or', 'but', 'because', 'so', 'if', 'when', 'while', 'whereas', 'though',
  'although', 'unless', 'until', 'since', 'than', 'that', 'then', 'however',
  'also', 'plus', 'either', 'neither', 'whether', 'whenever', 'wherever',
  // English: prepositions and articles that demand an object
  'the', 'a', 'an', 'of', 'to', 'for', 'with', 'from', 'into', 'onto', 'about',
  'on', 'in', 'at', 'by', 'as', 'per', 'via', 'under', 'over', 'above', 'below',
  'between', 'against', 'without', 'within', 'towards', 'toward', 'near',
  // English: auxiliaries/modals/pronouns left hanging
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'will',
  'would', 'can', 'could', 'should', 'shall', 'may', 'might', 'must', 'have',
  'has', 'had', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this',
  'these', 'those', 'some', 'any', 'each', 'every', 'which', 'what', 'who',
  'whom', 'whose', 'me', 'us', 'him', 'them', 'please', 'like', 'such', 'vs',
  // Hinglish / Roman Hindi
  'aur', 'ya', 'lekin', 'magar', 'kyunki', 'kyonki', 'kyu', 'agar', 'jab', 'tab',
  'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'par', 'tak', 'liye', 'wala', 'wali',
  'wale', 'mera', 'meri', 'mere', 'tumhara', 'tumhari', 'aapka', 'aapki',
  'apna', 'apni', 'ek', 'kuch', 'bahut', 'thoda', 'thodi', 'zyada', 'kam',
  'karna', 'karne', 'karke', 'raha', 'rahi', 'rahe', 'gaya', 'gayi', 'gaye',
  'pehle', 'baad', 'bina', 'saath', 'phir', 'fir', 'toh', 'iske', 'uske',
  'iska', 'uska', 'jaise', 'waise', 'jitna', 'utna', 'kaunsa', 'kaunsi',
  // Roman Marathi
  'ani', 'pan', 'mhanun', 'sathi', 'vara', 'madhe', 'kiva', 'kimva', 'tyanantar',
  'zyasta', 'kami', 'ekda',
]);

/**
 * True when the heard words cannot be a complete request, so the assistant
 * should wait for more instead of answering the fragment.
 *
 * Conservative on purpose: a false positive only delays a reply by up to
 * `incompleteExtensionMs`, a false negative cuts a person's request in half
 * and answers the wrong question.
 */
export function looksIncomplete(text: string): boolean {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  // An open bracket is an unfinished list/search/quote.
  const opens = (t.match(/[[({]/g) || []).length;
  const closes = (t.match(/[\])}]/g) || []).length;
  if (opens > closes) return true;
  // An odd number of straight quotes means the last one was never closed.
  if ((t.match(/"/g) || []).length % 2 === 1) return true;
  // Trailing punctuation that says "more coming".
  if (/[,;:–—-]$/.test(t)) return true;
  const words = t.split(' ').filter(Boolean);
  // A trailing arithmetic operator means the expression is not finished yet.
  if (/[+*/=×÷]$/.test(t) && words.length >= 2) return true;
  // A single heard word is more often a command ("stop") than a fragment.
  if (words.length < 2) return false;
  const last = words[words.length - 1].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return DANGLING_WORDS.has(last);
}

/** Join a new final segment onto what was already said, tolerating engines
 *  (Android Chrome) that resend the whole sentence so far as each "final". */
export function mergeSegment(committed: string, segment: string): string {
  const seg = segment.replace(/\s+/g, ' ').trim();
  const base = committed.replace(/\s+/g, ' ').trim();
  if (!seg) return base;
  if (!base) return seg;
  const nb = normalizeTranscript(base), ns = normalizeTranscript(seg);
  if (ns === nb || nb.endsWith(ns)) return base; // repeat of the tail
  if (ns.startsWith(nb)) return seg; // cumulative resend: take the longer one
  return `${base} ${seg}`;
}

export function createUtteranceAssembler(options: AssemblerOptions): UtteranceAssembler {
  const silenceOpt = options.silenceMs ?? SILENCE_MS_DEFAULT;
  const incompleteExtensionMs = Math.max(
    0,
    Math.round(options.incompleteExtensionMs ?? INCOMPLETE_EXTENSION_MS_DEFAULT),
  );
  const maxSilenceMs = Math.max(
    SILENCE_MS_MIN,
    Math.round(options.maxSilenceMs ?? MAX_SILENCE_MS_DEFAULT),
  );
  const pausedGraceMs = Math.max(0, Math.round(options.pausedGraceMs ?? PAUSED_GRACE_MS_DEFAULT));
  const minConfidence = options.minConfidence ?? 0.3;
  const dedupeMs = options.dedupeMs ?? 3000;
  const maxTurnMs = options.maxTurnMs ?? 60000;
  const speechActive = options.speechActive;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as any));

  let committed = '';
  let interim = '';
  let confidences: number[] = [];
  // -1 = "nothing heard yet". A clock that starts at 0 must not read as unset.
  let startedAt = -1;
  let lastHeardAt = -1;
  let timer: unknown = null;
  let lastAccepted = { text: '', at: -Infinity };
  // While the recognizer is down, quiet means "we cannot hear", not "finished".
  let paused = false;
  let pausedAt = 0;

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };
  const clear = () => {
    cancel();
    committed = '';
    interim = '';
    confidences = [];
    startedAt = -1;
    lastHeardAt = -1;
    paused = false;
    pausedAt = 0;
  };
  const current = () => mergeSegment(committed, interim);
  const elapsedMs = () => (startedAt < 0 ? 0 : now() - startedAt);
  const quietForMs = () => (lastHeardAt < 0 ? elapsedMs() : now() - lastHeardAt);

  /** How long this turn waits if nothing more is heard. */
  const waitMs = (): number => {
    const base = clampSilenceMs(typeof silenceOpt === 'function' ? silenceOpt() : silenceOpt);
    const extra = looksIncomplete(current()) ? incompleteExtensionMs : 0;
    return Math.min(maxSilenceMs, base + extra);
  };

  const emit = (): boolean => {
    // An unfinished interim at the end still counts: the person said it.
    const text = current();
    const conf = confidences.length ? Math.min(...confidences) : undefined;
    clear();
    if (!text) return false;
    const norm = normalizeTranscript(text);
    if (norm === lastAccepted.text && now() - lastAccepted.at < dedupeMs) return false;
    lastAccepted = { text: norm, at: now() };
    options.onAccept(text, conf);
    return true;
  };

  const check = () => {
    timer = null;
    if (!current()) return;
    const elapsed = elapsedMs();
    // The safety cap always wins: a rambling turn is still delivered.
    if (elapsed >= maxTurnMs) {
      emit();
      return;
    }
    // The wait is re-read, not remembered: the user may have changed the
    // end-of-speech setting and the room may have changed around them while
    // this very turn was being heard.
    const quietFor = quietForMs();
    const wait = waitMs();
    if (quietFor < wait) {
      timer = setTimer(check, Math.min(VOICE_POLL_MS, wait - quietFor));
      return;
    }
    // The recognizer is restarting: this silence is ours, not the person's —
    // but only for pausedGraceMs, so a dead recognizer never traps a turn.
    const deafTooLong = paused && now() - pausedAt > pausedGraceMs;
    // The mic still carries voice energy: results were dropped, not finished.
    // A throwing probe must never strand a turn, so it counts as "not talking".
    const talking = (() => {
      try {
        return !!speechActive?.();
      } catch {
        return false;
      }
    })();
    if ((paused && !deafTooLong) || talking) {
      timer = setTimer(check, VOICE_POLL_MS);
      return;
    }
    emit();
  };

  const arm = () => {
    cancel();
    const elapsed = elapsedMs();
    const quietFor = quietForMs();
    const wait = Math.max(0, Math.min(waitMs() - quietFor, maxTurnMs - elapsed));
    timer = setTimer(check, wait);
  };

  return {
    push(result) {
      const text = String(result.transcript || '').trim();
      if (!text) return 'empty';
      if (startedAt < 0) startedAt = now();
      lastHeardAt = now();
      // Hearing words proves the mic is open again, whatever onstart said.
      if (paused) {
        paused = false;
        pausedAt = 0;
      }
      if (!result.isFinal) {
        interim = text;
        arm();
        return 'interim';
      }
      const kind = classifyResult(true, result.confidence, minConfidence);
      if (kind === 'noise') {
        interim = '';
        if (committed) arm();
        else clear();
        return 'noise';
      }
      const before = committed;
      committed = mergeSegment(committed, text);
      interim = '';
      if (kind === 'accept') confidences.push(result.confidence as number);
      arm();
      return committed === before ? 'duplicate' : 'hold';
    },
    flush() {
      return current() ? emit() : false;
    },
    sendNow() {
      return current() ? emit() : false;
    },
    reset: clear,
    pending() {
      const text = current();
      return text || null;
    },
    preview: current,
    pause() {
      paused = true;
      pausedAt = now();
      // Nothing armed yet (e.g. the engine ended right after a final): start
      // the countdown now so the held turn is bounded even if onstart never
      // arrives.
      if (timer == null && current()) arm();
    },
    resume() {
      paused = false;
      pausedAt = 0;
    },
    isPaused() {
      return paused;
    },
    waitMs,
  };
}
