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
// segment of one turn and only hands the turn over after `silenceMs` without
// ANY new result (interim or final) — i.e. when the person actually stopped.

export interface AssemblerOptions {
  onAccept: (text: string, confidence?: number) => void;
  /** Quiet time after the last heard word before the turn is sent. Default 1600 ms. */
  silenceMs?: number;
  /** Real (non-zero) confidences below this are bleed/noise. Default 0.3. */
  minConfidence?: number;
  /** Identical turns inside this window are repeats. Default 3000 ms. */
  dedupeMs?: number;
  /** Safety cap: a turn is sent after this long even if speech never pauses. Default 60 s. */
  maxTurnMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface UtteranceAssembler extends FinalCollector {
  /** Committed words plus what is being heard right now (for the live caption). */
  preview(): string;
  /** Send whatever has been heard immediately ("Send now"). */
  sendNow(): boolean;
}

export const SILENCE_MS_DEFAULT = 1600;
export const SILENCE_MS_MIN = 700;
export const SILENCE_MS_MAX = 4000;

export function clampSilenceMs(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SILENCE_MS_DEFAULT;
  return Math.min(SILENCE_MS_MAX, Math.max(SILENCE_MS_MIN, Math.round(n)));
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
  const silenceMs = clampSilenceMs(options.silenceMs ?? SILENCE_MS_DEFAULT);
  const minConfidence = options.minConfidence ?? 0.3;
  const dedupeMs = options.dedupeMs ?? 3000;
  const maxTurnMs = options.maxTurnMs ?? 60000;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as any));

  let committed = '';
  let interim = '';
  let confidences: number[] = [];
  let startedAt = 0;
  let timer: unknown = null;
  let lastAccepted = { text: '', at: -Infinity };

  const cancel = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
  };
  const clear = () => {
    cancel();
    committed = '';
    interim = '';
    confidences = [];
    startedAt = 0;
  };
  const current = () => mergeSegment(committed, interim);

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

  const arm = () => {
    cancel();
    const elapsed = startedAt ? now() - startedAt : 0;
    const wait = Math.max(0, Math.min(silenceMs, maxTurnMs - elapsed));
    timer = setTimer(() => {
      timer = null;
      emit();
    }, wait);
  };

  return {
    push(result) {
      const text = String(result.transcript || '').trim();
      if (!text) return 'empty';
      if (!startedAt) startedAt = now();
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
  };
}
