// Fuzzy transcript matching. The deterministic handlers are regexes, and a
// single misheard word ("karacha" for "kharcha") used to send the whole turn to
// the generic AI. This module scores how close a heard phrase is to a known one
// and lets the app ASK instead of guessing: "Did you mean ‘kharcha 200 chai’?"
// Pure + tested. It never invents an intent — low confidence means no match.

/** Diacritics/punctuation/case-insensitive comparison form. */
export function normalizePhrase(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,!?;:"'“”‘’`()[\]{}#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokensOf = (text: string) => normalizePhrase(text).split(' ').filter(Boolean);

/** Bounded Levenshtein (returns `limit` as soon as it is exceeded). */
export function levenshtein(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const max = Math.min(limit, Math.max(a.length, b.length));
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return Math.min(prev[b.length], max + 1);
}

/** 0..1 character-level similarity of two strings (normalized first). */
export function similarity(a: string, b: string): number {
  const x = normalizePhrase(a);
  const y = normalizePhrase(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dist = levenshtein(x, y, Math.max(x.length, y.length));
  return Math.max(0, 1 - dist / Math.max(x.length, y.length));
}

const TOKEN_SIM = 0.72;

/** Fraction of the heard phrase's tokens that plausibly correspond to a token
 *  of the known phrase. Fuzzy per token, so word order and one typo are fine. */
export function tokenCoverage(heard: string, known: string): number {
  const target = tokensOf(known);
  const mine = tokensOf(heard);
  if (!target.length || !mine.length) return 0;
  let hit = 0;
  for (const t of mine) {
    if (target.includes(t)) hit += 1;
    else if (target.some((k) => levenshtein(t, k, 3) <= (t.length <= 4 ? 1 : 2) || similarity(t, k) >= TOKEN_SIM))
      hit += 1;
  }
  // Coverage is symmetric: "kharcha chai" must not score 1.0 against
  // "kharcha 200 chai and then pay rent and buy milk".
  const extra = Math.max(0, target.length - mine.length) / Math.max(target.length, 1);
  return Math.max(0, hit / Math.max(mine.length, target.length) - extra * 0.25);
}

/** Combined score used for "did you mean…?" 0..1. */
export function matchScore(heard: string, known: string): number {
  const s = similarity(heard, known);
  const c = tokenCoverage(heard, known);
  return Math.round((s * 0.55 + c * 0.45) * 100) / 100;
}

export interface DidYouMeanOptions {
  /** Minimum combined score to propose anything at all. */
  min?: number;
  /** How much better than the runner-up the winner must be. */
  margin?: number;
}

export interface Suggestion<T> {
  candidate: T;
  phrase: string;
  score: number;
}

/**
 * Pick the closest known phrase. Returns null when nothing is clearly closer
 * than the rest — a wrong guess costs the user more than a shrug.
 */
export function didYouMean<T extends { say: string }>(
  heard: string,
  candidates: T[],
  opts: DidYouMeanOptions = {},
): Suggestion<T> | null {
  const min = opts.min ?? 0.62;
  const margin = opts.margin ?? 0.08;
  const norm = normalizePhrase(heard);
  if (!norm) return null;
  const scored = candidates
    .map((candidate) => ({ candidate, phrase: candidate.say, score: matchScore(heard, candidate.say) }))
    .filter((s) => s.score >= min && normalizePhrase(s.phrase) !== norm)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < margin) return null;
  return scored[0];
}

const YES = /^(y|yes|yeah|yep|yup|sure|ok|okay|ha|haa|haan|han|ji|ji haan|haan ji|sahi|theek|theek hai|kar do|kar de|bilkul|confirm|correct|right|chal|ho gaya)$/i;
const NO = /^(n|no|nope|nahi|nahin|na|not now|mat(\s+(karo|kar\s*de|batana|bhulo))?|mt|rehne\s+do|chhod(\s+chhodo)?|cancel|skip|galat|wrong|stop|band\s+karo)$/i;

export function isAffirmative(text: string): boolean {
  return YES.test(normalizePhrase(text));
}

export function isNegative(text: string): boolean {
  return NO.test(normalizePhrase(text));
}

/** Is the transcript a plausible-but-unmatched command (worth asking about)
 *  rather than free-form conversation? Long, multi-clause sentences are left to
 *  the AI; short imperative-ish ones can be offered a suggestion. */
export function askableTranscript(text: string): boolean {
  const norm = normalizePhrase(text);
  if (norm.length < 4 || norm.length > 60) return false;
  if (norm.split(' ').length > 8) return false;
  return true;
}
