// "What time is it" / "aaj ka din kaunsa hai" — answered from the device clock.
// Deterministic, offline, and never sent to a model (audit finding I19): these
// used to fall through the whole router to the AI chain, and before the intent
// guard landed they were logged as a MEAL, because a date question contains no
// number and "aaj"/"today" matched the food logger.

import { hasPhrase, hasWord, isQuestion } from './intent-guard';

export type ClockAsk = 'time' | 'date' | 'both';

const ASK_WORDS = [
  'what', 'whats', 'what is', "what's", 'kya', 'kaunsa', 'kaun', 'kitne', 'kitna',
  'batao', 'tell', 'today', 'aaj', 'abhi', 'now',
];

const TIME_PHRASES = [
  'kitne baje', 'baje hain', 'baja hai', 'kya time', 'what time', 'time kya', 'abhi kitne',
  'time batao', 'samay kya', 'waqt kya', 'kya waqt', 'time hua', 'the time', 'time now',
  'current time', 'kitna samay', 'samay kitna', 'kitna time hua', 'what is the time',
];

const DATE_PHRASES = [
  'what day', 'kaunsa din', 'kaun sa din', 'aaj ka din', 'din kaunsa', 'aaj kya din',
  'what is the day', 'aaj ki date', 'aaj ki tarikh', 'date kya', 'kya date', 'tarikh kya',
  'which day', 'aaj kya hai', 'din kya',
];

/**
 * Is this a question about the current date or time? Null when the sentence
 * merely mentions a time or a day ("call mom at 5 pm", "the last meeting was on
 * monday", "I will be late today") — those belong to reminders, recall and the
 * AI, not to the clock.
 */
export function detectClockAsk(text: string): ClockAsk | null {
  const t = String(text || '').trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  // Long sentences are about something else; a clock question is short.
  if (lower.split(/\s+/).length > 12) return null;

  // A clock question asks about NOW. "how much time did I spend yesterday" uses
  // `time` as a quantity, and answering it with "It is 10:30 am" is a
  // non-sequitur — so the bare word only counts in a short question.
  const asksTime =
    hasPhrase(lower, ...TIME_PHRASES) ||
    (hasWord(lower, 'time', 'samay', 'waqt') &&
      lower.split(/\s+/).length <= 4 &&
      (isQuestion(t) || /^(abhi|now|kya|what|kitna|batao|tell)\b/.test(lower)));
  const asksDate =
    hasWord(lower, 'date', 'tarikh', 'tareekh') || hasPhrase(lower, ...DATE_PHRASES);
  if (!asksTime && !asksDate) return null;

  const isAsk =
    isQuestion(t) ||
    hasWord(lower, ...ASK_WORDS) ||
    hasPhrase(lower, ...ASK_WORDS.filter((w) => w.includes(' '))) ||
    /^(abhi|now|aaj|today)\b/.test(lower);
  if (!isAsk) return null;

  if (asksTime && asksDate) return 'both';
  return asksTime ? 'time' : 'date';
}

export interface ClockAnswer {
  title: string;
  body: string;
  speak: string;
}

export function answerClock(ask: ClockAsk, now: Date = new Date()): ClockAnswer {
  const time = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const date = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (ask === 'time') {
    const speak = `It is ${time}.`;
    return { title: 'Clock', body: speak, speak };
  }
  if (ask === 'date') {
    const speak = `Today is ${date}.`;
    return { title: 'Clock', body: speak, speak };
  }
  const speak = `It is ${date}, ${time}.`;
  return { title: 'Clock', body: speak, speak };
}
