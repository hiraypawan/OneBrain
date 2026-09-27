// Shared intent guards — the vocabulary every deterministic detector uses
// before it claims a sentence.
//
// Audit 2026-09-27 (docs/AUDIT-2026-09-27-VOICE-AND-INTENT.md) found the same
// mistake all over the router: detectors matched substrings with no word
// boundaries and no regard for sentence type, so ordinary speech was captured
// as data. "What is the date today" became a meal because `ate` lives inside
// `date`; "let us do 20 pushups" logged 2 pushups; "my parents are coming
// tomorrow" opened the money brief because `rent` lives inside `parents`.
//
// These helpers are deliberately small and pure. A detector that wants to fire
// on a word uses `hasWord`, and a detector that writes data checks
// `isQuestion` / `isPlanOrRequest` first.

const cache = new Map<string, RegExp>();

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A regex that matches only whole words — never inside another word.
 * `bounded('ate')` does not fire on "date", "create", "late" or "great".
 * Alternatives arrive already regex-ready, so `hasPhrase` can pass `a\s+b`.
 */
function buildBounded(alternatives: string[], flags: string): RegExp {
  const key = `${flags}:${alternatives.join('|')}`;
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`,
      flags,
    );
    cache.set(key, re);
  }
  return re;
}

export function bounded(...words: string[]): RegExp {
  return buildBounded(words.map(escaped), 'iu');
}

/** Same as `bounded`, but global — for stripping every occurrence. */
export function boundedAll(...words: string[]): RegExp {
  return buildBounded(words.map(escaped), 'giu');
}

/** True when any of these words appears as a whole word. */
export function hasWord(text: string, ...words: string[]): boolean {
  return bounded(...words).test(String(text || ''));
}

/** True when any of these multi-word phrases appears, whole-word bounded. */
export function hasPhrase(text: string, ...phrases: string[]): boolean {
  return buildBounded(
    phrases.map((p) => p.trim().split(/\s+/).map(escaped).join('\\s+')),
    'iu',
  ).test(String(text || ''));
}

/**
 * Remove every whole-word occurrence of these words and collapse the gaps.
 * For cleaning a label out of a sentence ("kharcha 200 chai" → "chai") without
 * eating letters out of the words that stay — an unanchored `rs` strip used to
 * mangle item names (audit finding I17).
 */
export function stripWords(text: string, ...words: string[]): string {
  return String(text || '')
    .replace(boundedAll(...words), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Sentence type
// ---------------------------------------------------------------------------

/** Wh-words and Hindi question words, in first position or anywhere. */
const QUESTION_WORD =
  /\b(what|whats|what's|when|where|which|who|whose|whom|why|how|kaun|kaunsa|kaunsi|kya|kyun|kyu|kab|kahan|kaha|kaisa|kaisi|kaise|kitna|kitne|kitni|kiske|kiska)\b/i;

/** Subject–auxiliary inversion: "did I", "is it", "can you", "should we". */
const INVERSION =
  /\b(did|do|does|is|are|was|were|am|have|has|had|can|could|should|would|will|shall|may|might|tell)\s+(i|you|we|they|he|she|it|this|that|there|my|your|a|an|the|me|us)\b/i;

/**
 * True when the sentence is asking rather than reporting.
 *
 * A question is never a log. "How many pushups should I do" must not write a
 * workout, and "what is the date today" must not write a meal.
 */
export function isQuestion(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  if (QUESTION_WORD.test(t)) return true;
  if (INVERSION.test(t)) return true;
  // Hindi questions with no question word still end in a copula question
  // ("match kab hai"), which QUESTION_WORD already covers via kab/kya/….
  return false;
}

/**
 * True when the sentence is planning, requesting or instructing rather than
 * reporting something that already happened. "Let us do 20 pushups" is a
 * suggestion; "20 pushups kar liye" is a log.
 */
const PLAN_FRAME =
  /\b(let us|let's|lets|let me|we should|i should|you should|should i|what should|how do i|how can i|what to do|i want to|i need to|i have to|plan to|planning to|going to|will do|would like|want me|tell me to|remind me to|make me|start|begin|try to|soch raha|soch rahi|socha|karna hai|karni hai|karna tha|karna chahiye|kya karu|kya karoon|kaise karu|kaise kare|chahiye|create|update|generate|revise|write|draft|show me how|tips|advice|suggest|recommend)\b/i;

export function isPlanOrRequest(text: string): boolean {
  return PLAN_FRAME.test(String(text || ''));
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Words that say "this already happened". A log needs one of these (or a bare
 * quantity + unit, which the callers check themselves) — that is what separates
 * "2 roti khayi" from "roti banani hai".
 */
const DONE_WORDS = [
  // English
  'ate', 'eaten', 'had', 'drank', 'slept', 'ran', 'walked', 'cycled', 'did', 'done',
  'completed', 'finished', 'spent', 'paid', 'logged', 'took', 'went',
  // Hinglish / Hindi
  'khaya', 'khayi', 'khaaya', 'kha', 'piya', 'pi', 'soya', 'soyi', 'kiya', 'kiye', 'kiye',
  'kar', 'liya', 'liye', 'gaya', 'gayi', 'gaye', 'ho', 'gayi', 'chala', 'chali', 'dauda',
  'bana', 'banaya', 'diya', 'diye', 'dala', 'daala', 'hua', 'hui', 'hue', 'aaya', 'aayi',
];

export function hasDoneWord(text: string): boolean {
  return hasWord(text, ...DONE_WORDS);
}

/** Imperative logging verbs: "log 200", "note down 2 roti", "add 500". */
const LOG_VERBS = ['log', 'note', 'add', 'record', 'enter', 'save', 'track', 'dal', 'daal', 'likh', 'likho'];

export function hasLogVerb(text: string): boolean {
  return hasWord(text, ...LOG_VERBS);
}

/**
 * Follow-up words. On their own they mean "keep going with what we were doing"
 * — they must never open a feature. Audit findings I6/I7: "aage batao" started
 * a bedtime story and "aur sunao" started music, from a cold session.
 */
const FOLLOW_UPS = [
  'continue', 'aage', 'aage batao', 'aur', 'aur sunao', 'aur batao', 'next', 'next part',
  'go on', 'carry on', 'keep going', 'tell me more', 'batao', 'sunao', 'phir', 'then what',
  'aage kya', 'what else', 'anything else',
];

export function isFollowUp(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  // Short lines only: a long sentence that happens to contain "next" is about
  // something else ("next week I have an exam").
  if (t.split(/\s+/).length > 5) return false;
  return hasPhrase(t, ...FOLLOW_UPS);
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

/**
 * Units and count nouns that confirm a spoken number word really is a number:
 * "do roti" is 2, "do" in "let us do 20 pushups" is not. Used by
 * lib/numbers.ts to decide whether an ambiguous Hindi number word counts.
 */
export const COUNT_UNITS = [
  // time
  'minute', 'minutes', 'min', 'hour', 'hours', 'hr', 'hrs', 'ghanta', 'ghante', 'ghanton',
  'second', 'seconds', 'sec', 'secs', 'din', 'day', 'days', 'week', 'weeks', 'hafte', 'hafta',
  'month', 'months', 'mahina', 'maheena', 'saal', 'year', 'years', 'baar', 'times', 'dafa',
  // money
  'rupay', 'rupaye', 'rupee', 'rupees', 'rs', 'inr', 'paisa', 'paise', 'taka', 'dollar', 'dollars',
  // food / portions
  'roti', 'rotis', 'paratha', 'parathe', 'parathas', 'glass', 'glasses', 'cup', 'cups', 'bottle',
  'bottles', 'litre', 'litres', 'liter', 'liters', 'ml', 'plate', 'plates', 'bowl', 'bowls',
  'piece', 'pieces', 'pc', 'pcs', 'slice', 'slices', 'spoon', 'spoons', 'chammach', 'packet',
  'packets', 'pack', 'packs', 'egg', 'eggs', 'anda', 'ande', 'chai', 'katori',
  // exercise / measure
  'pushup', 'pushups', 'pullup', 'pullups', 'squat', 'squats', 'situp', 'situps', 'rep', 'reps',
  'set', 'sets', 'round', 'rounds', 'step', 'steps', 'kadam', 'km', 'kilometer', 'kilometre',
  'kilometers', 'mile', 'miles', 'meter', 'meters', 'metre', 'metres', 'kg', 'kilo', 'kilos',
  'gram', 'grams', 'gm', 'percent', 'page', 'pages', 'chapter', 'chapters',
  // people / things
  'log', 'logon', 'people', 'aadmi', 'bande', 'item', 'items', 'cheez', 'cheezein', 'task',
  'tasks', 'kaam',
];

const UNIT_SET = new Set(COUNT_UNITS.map((u) => u.toLowerCase()));

/** True when the token is a unit/count noun that can confirm a number word. */
export function isCountUnit(token: string): boolean {
  return UNIT_SET.has(String(token || '').toLowerCase());
}

/** True when the sentence names a measurable unit (used to refuse money logs). */
export function mentionsMeasureUnit(text: string): boolean {
  return hasWord(
    text,
    'hour', 'hours', 'hr', 'hrs', 'ghanta', 'ghante', 'minute', 'minutes', 'min', 'second',
    'seconds', 'sec', 'day', 'days', 'din', 'week', 'weeks', 'hafte', 'month', 'months',
    'km', 'kilometer', 'kilometre', 'mile', 'miles', 'kg', 'kilo', 'gram', 'grams', 'litre',
    'liter', 'liters', 'ml', 'percent', 'time', 'waqt',
  );
}
