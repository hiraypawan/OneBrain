import { describe, expect, it } from 'vitest';
import {
  askableTranscript,
  didYouMean,
  isAffirmative,
  isNegative,
  levenshtein,
  matchScore,
  normalizePhrase,
  similarity,
  tokenCoverage,
} from '@/lib/fuzzy';
import { INTENT_HINTS } from '@/lib/intents';
import { buildContextEnvelope, envelopeForPrompt, estimateTokens } from '@/lib/context-envelope';
import type { FitnessLog } from '@/lib/fitness';


describe('fuzzy phrase matching', () => {
  it('normalizes case, punctuation and diacritics', () => {
    expect(normalizePhrase('  Kharcha, 200 CHAI! ')).toBe('kharcha 200 chai');
    expect(normalizePhrase('“Kélay khaaya”')).toBe('kelay khaaya');
  });
  it('measures edit distance but bails out past the limit', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('aaaa', 'bbbb', 1)).toBeGreaterThan(1);
    expect(levenshtein('', 'abc')).toBe(3);
  });
  it('scores a near-miss above an unrelated sentence', () => {
    const near = matchScore('show my expensies this month', 'show my expenses this month');
    const far = matchScore('what is the capital of france', 'show my expenses this month');
    expect(near).toBeGreaterThan(0.8);
    expect(far).toBeLessThan(0.5);
    expect(similarity('same words here', 'same words here')).toBe(1);
    expect(tokenCoverage('kharcha chai', 'kharcha 200 chai and pay rent and buy milk')).toBeLessThan(0.7);
  });
  it('proposes the closest known phrase for a misheard command', () => {
    const guess = didYouMean('open my expences this month', INTENT_HINTS);
    expect(guess?.candidate.say).toBe('open my expenses this month');
    const food = didYouMean('show my halth trends', INTENT_HINTS);
    expect(food?.candidate.say).toBe('show my health trends');
  });
  it('stays silent for free-form questions and exact matches', () => {
    expect(didYouMean('explain how a budget works in a small startup', INTENT_HINTS)).toBeNull();
    expect(didYouMean('what is the weather tomorrow', INTENT_HINTS)).toBeNull();
    // Already understood exactly: no suggestion needed.
    expect(didYouMean('show my workouts', INTENT_HINTS)).toBeNull();
    expect(didYouMean('', INTENT_HINTS)).toBeNull();
  });
  it('refuses to guess between two close candidates', () => {
    const tie = didYouMean('kharcha', [{ say: 'kharcha' }, { say: 'kharcha' }]);
    expect(tie).toBeNull();
  });
  it('accepts Hinglish and English confirmations, and rejects everything else', () => {
    for (const yes of ['yes', 'Yeah!', 'haan', 'ji haan', 'haan ji', 'theek hai', 'kar do', 'ok']) {
      expect(isAffirmative(yes), yes).toBe(true);
    }
    for (const no of ['no', 'nahi', 'mat karo', 'rehne do', 'cancel', 'galat']) {
      expect(isNegative(no), no).toBe(true);
    }
    expect(isAffirmative('no')).toBe(false);
    expect(isNegative('yes')).toBe(false);
    expect(isAffirmative('yes and then pay the bill')).toBe(false);
  });
  it('only asks about short imperative-sounding transcripts', () => {
    expect(askableTranscript('open trak')).toBe(true);
    expect(askableTranscript('hi')).toBe(false);
    expect(askableTranscript('could you please tell me everything you know about the history of the maratha empire')).toBe(false);
    expect(askableTranscript('one two three four five six seven eight nine ten')).toBe(false);
  });

  it('knows every phrase it wants confirmed is spoken the way it is matched', () => {
    // A hint whose `say` is already handled by a strict parser would offer a
    // suggestion the user cannot refuse; keep the list to view/find commands.
    for (const hint of INTENT_HINTS) {
      expect(hint.say.length, hint.say).toBeLessThan(48);
      expect(hint.label.length, hint.say).toBeGreaterThan(3);
    }
    expect(new Set(INTENT_HINTS.map((h) => h.say)).size).toBe(INTENT_HINTS.length);
  });

});

describe('token-budgeted context envelope', () => {
  const log = (over: Partial<FitnessLog> = {}): FitnessLog => ({
    id: Math.random().toString(36).slice(2),
    kind: 'expense',
    label: 'Spent ₹400 — groceries',
    amount: 400,
    currency: 'INR',
    createdAt: Date.parse('2026-09-16T09:00:00'),
    source: 'voice',
    ...over,
  });
  const input = {
    tasks: [
      { title: 'Pay the electricity bill', due: '2026-09-14', kind: 'task', status: 'active' },
      { title: 'Draft the Diwali post', due: '2026-09-20', kind: 'task', status: 'active' },
      { title: 'Finished thing', kind: 'task', status: 'done' },
    ],
    reminders: [
      { title: 'Call Mom', time: '19:30' },
      { title: 'Submit GST', time: '09:00', date: '2026-09-17' },
    ],
    sessionSummary: 'Earlier: asked about a client invoice, then about travel.',
    conversations: [{ title: 'Invoice follow-up', snippet: 'GST rate question' }],
    fitnessLogs: [log(), log({ kind: 'food', label: '2 roti + dal', calories: 210 })],
    serverNotes: [],
    now: Date.parse('2026-09-16T12:00:00'),
  };

  it('estimates tokens from characters, conservatively', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(360))).toBe(100);
  });

  it('leads with open tasks and skips finished ones', () => {
    const env = buildContextEnvelope(input);
    expect(env.text).toContain('Pay the electricity bill (overdue');
    expect(env.text).toContain('Draft the Diwali post');
    expect(env.text).not.toContain('Finished thing');
    expect(env.included[0]).toMatch(/^OPEN TASKS/);
  });

  it('carries reminders, the log and the rolling summary', () => {
    const env = buildContextEnvelope(input);
    expect(env.text).toContain('Call Mom at 19:30 (daily)');
    expect(env.text).toContain('Submit GST at 09:00 on 2026-09-17');
    expect(env.text).toContain('₹400');
    expect(env.text).toContain('Earlier: asked about a client invoice');
    expect(env.text).toContain('Invoice follow-up');
    expect(env.chars).toBeLessThanOrEqual(1400);
    expect(env.tokens).toBe(estimateTokens(env.text));
  });

  it('drops the lowest-priority sections when the budget is tight, and says so', () => {
    const tight = buildContextEnvelope({ ...input, budgetChars: 300 });
    expect(tight.chars).toBeLessThanOrEqual(300);
    expect(tight.text).toContain('Pay the electricity bill');
    expect(tight.dropped.length).toBeGreaterThan(0);
    expect(tight.dropped.every((n) => !n.startsWith('OPEN TASKS'))).toBe(true);
    // Nothing is silently missing: whatever was cut is listed as dropped.
    expect(tight.included.length + tight.dropped.length).toBeGreaterThanOrEqual(4);
  });

  it('is empty-and-cheap when the user has saved nothing', () => {
    const empty = buildContextEnvelope({ tasks: [], reminders: [], fitnessLogs: [], now: input.now });
    expect(empty.text).toBe('');
    expect(empty.included).toEqual([]);
    expect(envelopeForPrompt(empty)).toBe('');
  });

  it('wraps the block as untrusted data and forbids calendar claims', () => {
    const wrapped = envelopeForPrompt(buildContextEnvelope(input));
    expect(wrapped).toContain('untrusted user data');
    expect(wrapped).toContain('Never claim to have checked');
    expect(wrapped).toContain('OPEN TASKS');
  });
});
