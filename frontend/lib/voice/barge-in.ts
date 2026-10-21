// Talking with the assistant like a person: interrupt it mid-sentence, and let
// it pick the answer up where it stopped instead of starting over.
//
// The rules here are pure and testable:
//  - While the assistant is speaking, ONLY interruption phrases are accepted
//    from the microphone. Anything else is logged and ignored, because the mic
//    can hear the assistant's own voice (and the TV). This is what makes
//    barge-in safe without server-side echo cancellation.
//  - When speech is cut, the agreed progress point is the last completed
//    sentence chunk, never a mid-word guess. Resuming re-speaks at most one
//    sentence, it never silently drops one.
//  - "continue" (and its Hindi/Hinglish twins) resume; it is a different phrase
//    from the session control "continue" that only re-opens the microphone,
//    which the caller decides.

export type WhileSpeaking = 'ignore' | 'stop-speaking' | 'resume' | 'end-session';

/** Phrases that legitimately mean "stop talking right now". */
const STOP_PHRASES = [
  'stop', 'stop it', 'stop talking', 'stop the answer', 'shut up', 'quiet',
  'chup', 'chup karo', 'chupko', 'ruko', 'ruk jao', 'ruk', 'bas', 'bas karo',
  'wait', 'hold on', 'hold on a second', 'pause', 'pause talking', 'band karo',
  'ek minute', 'suno', 'suno ruko',
];

/** Phrases that mean "keep going from where you stopped". */
const RESUME_PHRASES = [
  'continue', 'continue please', 'continue where you left off', 'carry on',
  'go on', 'keep going', 'keep talking', 'finish it', 'finish the answer',
  'the rest', 'rest of it', 'say the rest', 'tell me the rest', 'go ahead',
  'aage bolo', 'aage sunao', 'aage suna do', 'aage chalo', 'aage badho',
  'baaki bolo', 'baaki sunao', 'baki bolo', 'baki sunao', 'poora bolo',
  'jahan chhoda', 'jahan choda', 'wahan se bolo', 'phir se shuru', 'phir se bolo',
];

/** Phrases that end the whole voice session (used only while speaking). */
const END_SESSION_PHRASES = ['stop listening', 'stop the session', 'goodbye', 'bye', 'band ho jao', 'so jao'];

export function normalizeSpoken(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:"'`~(){}[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(normalized: string, phrases: string[]): boolean {
  if (!normalized) return false;
  // The wake word may lead the phrase ("OneBrain stop").
  const bare = normalized.replace(/^(hey |ok |o k |one ?brain |brain )+/, '').trim();
  for (const phrase of phrases) {
    if (bare === phrase) return true;
    // A short trailing politeness is still the same command.
    if (bare.startsWith(phrase + ' ') && bare.length - phrase.length <= 8) return true;
  }
  return false;
}

export function isInterruptPhrase(transcript: string): boolean {
  return matches(normalizeSpoken(transcript), STOP_PHRASES);
}

export function isResumeRequest(transcript: string): boolean {
  return matches(normalizeSpoken(transcript), RESUME_PHRASES);
}

export function isEndSessionPhrase(transcript: string): boolean {
  return matches(normalizeSpoken(transcript), END_SESSION_PHRASES);
}

/**
 * What should the app do about this transcript while it is speaking?
 * Only these three intents get through; anything else is 'ignore' so the
 * assistant's own voice cannot become a new question.
 */
export function classifyWhileSpeaking(transcript: string): WhileSpeaking {
  const text = normalizeSpoken(transcript);
  if (!text) return 'ignore';
  if (isEndSessionPhrase(text)) return 'end-session';
  if (isInterruptPhrase(text)) return 'stop-speaking';
  if (isResumeRequest(text)) return 'resume';
  return 'ignore';
}

export interface SpeechProgress {
  /** The full reply text as prepared for speech. */
  text: string;
  /** Characters of `text` that were actually heard. Always a sentence boundary. */
  spokenChars: number;
  /** When the interruption happened (ms epoch). */
  at: number;
}

/** Sentence split that keeps terminal punctuation, for chunk-aligned progress. */
export function splitSentences(text: string): string[] {
  const source = String(text || '').trim();
  if (!source) return [];
  const parts = source.match(/[^.!?।॥\n]+[.!?।॥]+[\s]*|[^.!?।॥\n]+$/g);
  if (!parts) return [source];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function sentencesSpoken(fullText: string, spokenChars: number): number {
  const sentences = splitSentences(fullText);
  let consumed = 0;
  let spoken = 0;
  for (const sentence of sentences) {
    // Locate the sentence in the original text so whitespace between
    // sentences is counted the same way by both sides.
    const index = String(fullText).indexOf(sentence, consumed);
    const end = index < 0 ? consumed + sentence.length : index + sentence.length;
    consumed = end;
    if (end <= spokenChars) spoken += 1;
  }
  return spoken;
}

/**
 * Build the progress record for an interruption. Returns null when nothing was
 * spoken yet (there is nothing to resume — that is a fresh turn, not a
 * half-heard answer) or when the whole reply already finished.
 */
export function recordInterruption(
  fullText: string,
  spokenChars: number,
  at: number,
): SpeechProgress | null {
  const text = String(fullText || '').trim();
  if (!text) return null;
  const bounded = Math.max(0, Math.min(text.length, Math.floor(spokenChars)));
  if (bounded <= 0) return null;
  if (bounded >= text.length) return null;
  return { text, spokenChars: bounded, at };
}

/** The part of the reply that was never heard. Empty when there is nothing left. */
export function remainingSpeech(progress: SpeechProgress | null | undefined): string {
  if (!progress) return '';
  return progress.text.slice(Math.max(0, Math.min(progress.text.length, progress.spokenChars))).trim();
}

/** A stale progress point must not resurface an answer from yesterday. */
export function isProgressStale(progress: SpeechProgress | null | undefined, now: number, ttlMs = 10 * 60 * 1000): boolean {
  if (!progress) return true;
  return now - progress.at > ttlMs;
}

/** What to offer the user after an interruption. */
export function resumeOffer(progress: SpeechProgress | null | undefined): string | null {
  const rest = remainingSpeech(progress);
  if (!rest) return null;
  const sentences = splitSentences(rest).length;
  if (sentences <= 0) return null;
  return `Say “continue” to hear the rest (${sentences} ${sentences === 1 ? 'line' : 'lines'} left).`;
}

/** Byte offsets where each sentence begins in the full reply. */
export function sentenceStarts(fullText: string): { sentence: string; start: number; end: number }[] {
  const text = String(fullText || '');
  const out: { sentence: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const found = text.indexOf(sentence, cursor);
    const start = found < 0 ? cursor : found;
    const end = start + sentence.length;
    out.push({ sentence, start, end });
    cursor = end;
  }
  return out;
}

/** Where the unspoken remainder begins inside the full reply. */
export function resumeOffset(progress: SpeechProgress | null | undefined): number | null {
  if (!progress) return null;
  const parts = sentenceStarts(progress.text);
  const firstUnheard = parts.findIndex((part) => part.end > progress.spokenChars);
  if (firstUnheard < 0) return null;
  return parts[firstUnheard].start;
}

/** What to speak on resume, and where that text starts in the full reply. */
export function resumePlan(progress: SpeechProgress | null | undefined): { text: string; offset: number } | null {
  if (!progress) return null;
  const text = resumeText(progress);
  const offset = resumeOffset(progress);
  if (!text || offset == null) return null;
  return { text, offset };
}

/**
 * Choose what to say when the user resumes: the first sentence that was not
 * heard in full, plus everything after it.
 *
 * The cut point is always a sentence start, so a resume never opens on a
 * fragment ("sra point aakhir mein.") — at worst it repeats the sentence that
 * was interrupted, which is how a person would pick a sentence back up.
 */
export function resumeText(progress: SpeechProgress | null | undefined): string | null {
  if (!progress) return null;
  const parts = sentenceStarts(progress.text);
  const firstUnheard = parts.findIndex((part) => part.end > progress.spokenChars);
  if (firstUnheard < 0) return null;
  return parts.slice(firstUnheard).map((part) => part.sentence).join(' ').trim() || null;
}
