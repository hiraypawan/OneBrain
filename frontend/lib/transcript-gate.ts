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
