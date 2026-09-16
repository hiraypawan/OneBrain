import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFeatureTurn, detectFitnessRangeQuery } from '../lib/feature-engine';
import { useFeaturesStore } from '../store/features';
import { useAssistantStore } from '../store/assistant';
import { INITIAL_WITNESS } from '../lib/witness';
import { EMPTY_QUOTA } from '../lib/plans';
import type { FitnessLog } from '../lib/fitness';

const DAY = 86400000;
const mkLog = (over: Partial<FitnessLog> = {}): FitnessLog => ({
  id: Math.random().toString(), kind: 'expense', label: 'x', createdAt: Date.now(), source: 'voice', ...over,
});

function yesterdayAt(hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

beforeEach(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  useFeaturesStore.setState({
    card: null, emailSession: null, persona: null, translator: null,
    story: null, workout: null, witness: { ...INITIAL_WITNESS, log: [] },
    plan: 'free', usage: { ...EMPTY_QUOTA }, commitments: [],
    fitnessLogs: [], nightNotes: [], stories: [], emailDrafts: [],
  });
  useAssistantStore.setState({ messages: [], reminders: [], micNotice: null });
  await useFeaturesStore.getState().load();
  useFeaturesStore.setState({
    plan: 'free', usage: { ...EMPTY_QUOTA }, commitments: [],
    fitnessLogs: [], nightNotes: [], stories: [],
  });
});

describe('detectFitnessRangeQuery', () => {
  it('matches expense/food questions with dates', () => {
    expect(detectFitnessRangeQuery('what expenses did I do yesterday')).toBe(true);
    expect(detectFitnessRangeQuery('kal kitna kharcha hua')).toBe(true);
    expect(detectFitnessRangeQuery('how much did I spend this week')).toBe(true);
    expect(detectFitnessRangeQuery('yesterday khana kya khaya')).toBe(true);
  });
  it('matches question phrasings without dates (default today)', () => {
    expect(detectFitnessRangeQuery('how much did I spend')).toBe(true);
    expect(detectFitnessRangeQuery('mere kharche batao')).toBe(true);
  });
  it('does not steal plain log statements', () => {
    expect(detectFitnessRangeQuery('kharcha 200 chai')).toBe(false);
    expect(detectFitnessRangeQuery('I spent 200 on chai')).toBe(false);
    expect(detectFitnessRangeQuery('2 roti khayi')).toBe(false);
    expect(detectFitnessRangeQuery('20 pushups kar liye')).toBe(false);
    expect(detectFitnessRangeQuery('mausam kaisa hai')).toBe(false);
  });
});

describe('yesterday expense recall (deterministic, offline)', () => {
  beforeEach(() => {
    useFeaturesStore.setState({
      fitnessLogs: [
        mkLog({ label: 'Spent ₹200 — chai', amount: 200, qty: 200, unit: 'INR', createdAt: yesterdayAt(10) }),
        mkLog({ label: 'Spent ₹350 — sabzi', amount: 350, qty: 350, unit: 'INR', createdAt: yesterdayAt(18) }),
        mkLog({ kind: 'food', label: '2 roti', qty: 2, unit: 'pc', calories: 140, createdAt: Date.now() - 3600000 }),
      ],
    });
  });

  it('answers English yesterday-expense questions with the exact total', async () => {
    const turn = await handleFeatureTurn('what expenses did I do yesterday');
    expect(turn).not.toBeNull();
    expect(turn?.messages[0].text).toContain('₹550');
    expect(turn?.messages[0].text).toContain('chai');
    expect(turn?.messages[0].text).toContain('sabzi');
    // Today's food must NOT leak into yesterday's answer.
    expect(turn?.messages[0].text).not.toContain('2 roti');
    expect(turn?.speak).toMatch(/550/);
  });

  it('answers Hinglish (kal kharcha) the same way', async () => {
    const turn = await handleFeatureTurn('kal kitna kharcha hua');
    expect(turn?.messages[0].text).toContain('₹550');
    expect(turn?.speak).toMatch(/550/);
  });

  it('is honest when the range is empty and teaches the log phrase', async () => {
    const turn = await handleFeatureTurn('what did I spend last week');
    expect(turn?.messages[0].text).toMatch(/No expenses logged/);
    expect(turn?.messages[0].text).toContain('kharcha 200 chai');
  });

  it('still logs plain expense statements instead of querying', async () => {
    const turn = await handleFeatureTurn('kharcha 120 vada pav');
    expect(turn?.speak).toMatch(/Logged/);
    const logs = useFeaturesStore.getState().fitnessLogs;
    expect(logs.some((l) => l.kind === 'expense' && l.amount === 120)).toBe(true);
  });
});
