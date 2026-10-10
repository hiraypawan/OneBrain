import { describe, it, expect } from 'vitest';
import { buildProfileBlock, estimateTokens } from '../lib/profile';
import { keywords, recallRelevant, formatRecall } from '../lib/recall';
import { extractiveSummary, rollingSummaryStep, splitForCompaction, SUMMARY_KEEP_MESSAGES } from '../lib/summarize';
import { fitHistory, assemblePrompt, BUDGETS } from '../lib/context';
import { monthKey } from '../lib/janitor';

describe('buildProfileBlock', () => {
  it('is empty with nothing known', () => {
    expect(buildProfileBlock({})).toBe('');
  });

  it('packs name, topics, routine, summary', () => {
    const out = buildProfileBlock({
      name: 'Asha',
      digest: {
        totalMessages: 10, userMessages: 6, activeDays: 2,
        topics: [{ topic: 'trains', count: 4 }],
        activeHours: [], routineNotes: ['Most active around 18:00.'], perDay: [],
      },
      summary: 'Asked about trains.',
    });
    expect(out).toMatch(/Asha/);
    expect(out).toMatch(/trains/);
    expect(out).toMatch(/18:00/);
    expect(estimateTokens(out)).toBeLessThanOrEqual(200);
  });
});

describe('recall', () => {
  const pool = [
    { role: 'user', content: 'When is the next train to Pune?', createdAt: Date.now() - 1000 },
    { role: 'assistant', content: '6:42 PM from platform 2.', createdAt: Date.now() - 900 },
    { role: 'user', content: 'Remind me to buy milk', createdAt: Date.now() - 800 },
  ];

  it('finds topically relevant older messages', () => {
    const hits = recallRelevant('train timing today?', pool);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toMatch(/train/i);
  });

  it('returns nothing without keyword overlap', () => {
    expect(recallRelevant('weather in Goa?', pool)).toHaveLength(0);
  });

  it('formats excerpts with speaker labels', () => {
    expect(formatRecall(recallRelevant('train?', pool))).toMatch(/said:/);
    expect(formatRecall([])).toBe('');
  });

  it('extracts keywords, dropping stopwords and matching basic preference synonyms', () => {
    expect(keywords('What is the time in India right now?')).toContain('india');
    expect(keywords('what is the?')).toHaveLength(0);
    expect(recallRelevant('What food do I like?', [
      { role: 'user', content: 'I prefer dal for lunch.', createdAt: Date.now() },
    ])).toHaveLength(1);
  });

  it('labels a recalled excerpt with its saved conversation title and date', () => {
    const createdAt = Date.UTC(2026, 8, 2, 12);
    const text = formatRecall(recallRelevant('Pune Goa train trip?', [
      { role: 'user', content: 'My Pune to Goa train trip is on Friday.', createdAt, conversationTitle: 'Goa weekend' },
    ]));
    expect(text).toContain('“Goa weekend”');
    expect(text).toContain('2026-09-02');
  });
});

describe('summarize + budget', () => {
  const msgs = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `Message number ${i} about trains and commute routine.`,
    createdAt: Date.now() - (30 - i) * 60000,
  }));

  it('extracts a bounded summary', () => {
    const s = extractiveSummary(msgs, 'Old stuff.');
    expect(s).toMatch(/Previously: Old stuff/);
    expect(s.length).toBeLessThanOrEqual(800);
  });

  it('keeps a message-index cursor and folds only newly covered messages on refresh', () => {
    const makeTurns = (start: number, count: number) => Array.from({ length: count }, (_, i) => {
      const n = start + i;
      return [
        { role: 'user', content: `Turn ${n} unique detail about trains.`, createdAt: n * 2 },
        { role: 'assistant', content: `Reply ${n}.`, createdAt: n * 2 + 1 },
      ];
    }).flat();
    const firstMessages = makeTurns(0, 12);
    const first = rollingSummaryStep(firstMessages, '', { mark: 0, at: null }, 60_000);
    expect(first).not.toBeNull();
    expect(first!.state.mark).toBe(firstMessages.length - SUMMARY_KEEP_MESSAGES);
    expect(first!.summary).toContain('Turn 5 unique detail');

    const allMessages = [...firstMessages, ...makeTurns(12, 6)];
    const second = rollingSummaryStep(allMessages, first!.summary, first!.state, 120_000);
    expect(second).not.toBeNull();
    expect(second!.state.mark).toBe(allMessages.length - SUMMARY_KEEP_MESSAGES);
    expect(second!.summary).toContain('Turn 11 unique detail');
    // Turn 5 belongs in the previous summary, but must not be folded again.
    expect(second!.summary.match(/Turn 5 unique detail/g)).toHaveLength(1);
  });

  it('does not refresh while the only unrolled messages are still in the retained tail', () => {
    const tail = Array.from({ length: SUMMARY_KEEP_MESSAGES }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(1000), createdAt: i,
    }));
    expect(rollingSummaryStep(tail, '', { mark: 0, at: null }, 60_000)).toBeNull();
  });

  it('splits old (summarize) from new (keep) by budget', () => {
    const { summarize, keep } = splitForCompaction(msgs, estimateTokens, 200);
    expect(summarize.length + keep.length).toBe(msgs.length);
    expect(keep.length).toBeGreaterThan(0);
    expect(keep[keep.length - 1].content).toMatch(/Message number 29/);
  });

  it('fitHistory keeps everything under budget, newest first', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 ? 'user' : 'assistant',
      content: 'x'.repeat(200),
    }));
    const fit = fitHistory(big);
    const cost = fit.reduce((a, m) => a + estimateTokens(m.content) + 8, 0);
    expect(cost).toBeLessThanOrEqual(BUDGETS.history);
    expect(fit.length).toBeLessThan(big.length);
  });

  it('assemblePrompt stays within envelope', () => {
    const p = assemblePrompt({ profile: 'p', summary: 's', recall: 'r', history: [] });
    expect(estimateTokens(p)).toBeLessThanOrEqual(BUDGETS.profile + BUDGETS.summary + BUDGETS.recall + 50);
  });
});

describe('janitor helpers', () => {
  it('buckets months correctly', () => {
    expect(monthKey(new Date('2026-09-06T10:00:00').getTime())).toBe('2026-09');
  });
});
