import 'fake-indexeddb/auto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fuzzySuggestion, handleFeatureTurn } from '../lib/feature-engine';
import { askableTranscript } from '../lib/fuzzy';
import { INTENT_HINTS } from '../lib/intents';
import { parseTrackCommand } from '../lib/track';
import { useFeaturesStore } from '../store/features';
import { useAssistantStore } from '../store/assistant';
import { EMPTY_QUOTA } from '../lib/plans';

const root = join(__dirname, '..');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  useFeaturesStore.setState({
    card: null,
    fitnessLogs: [],
    pendingIntent: null,
    plan: 'free',
    usage: { ...EMPTY_QUOTA },
    trackGoals: { kcalGoal: 2200, sleepGoal: 7, waterGoal: 8, budget: 0, budgetCurrency: 'INR' },
  });
  useAssistantStore.setState({ messages: [], reminders: [], micNotice: null, sessionSummary: null });
  await useFeaturesStore.getState().load();
  useFeaturesStore.setState({ fitnessLogs: [], pendingIntent: null });
});

describe('the gate that decides to ask', () => {
  it('recovers a misheard Track or expense phrase', () => {
    expect(fuzzySuggestion('open my expences this month')?.candidate.say).toBe('open my expenses this month');
    expect(fuzzySuggestion('shwo my workouts')?.candidate.say).toBe('show my workouts');
    // A typo the Track parser already resolves must NOT be questioned — asking
    // about a sentence the app understands would be worse than just doing it.
    expect(fuzzySuggestion('show my food diery today')).toBeNull();
    expect(parseTrackCommand('show my food diery today')).toMatchObject({
      action: 'open',
      lens: 'food',
      range: 'day',
    });
  });
  it('stays out of the way of sentences the app already understands', () => {
    // Each of these is owned by another path; asking about them would be a
    // regression dressed up as help.
    for (const line of [
      'remind me to call mom at 6pm',
      'mujhe dawai yaad dilao subah 9 baje',
      'stop',
      'new chat',
      'play kesariya',
      'gaana band',
      'kharcha 200 chai',
      '20 pushups kar liye',
      'what expenses did I do today',
      'explain how a budget works in a small startup',
    ]) {
      expect(fuzzySuggestion(line), line).toBeNull();
    }
  });
  it('lists only phrases the router actually resolves', async () => {
    // Drift guard: a hint that resolves to nothing would turn a helpful
    // "did you mean" into "sorry, I could not run that".
    for (const hint of INTENT_HINTS) {
      const turn = await handleFeatureTurn(hint.say);
      expect(turn, hint.say).toBeTruthy();
      expect(turn?.messages?.length, hint.say).toBeGreaterThan(0);
    }
  });
  it('ignores one-word and long rambling transcripts', () => {
    expect(fuzzySuggestion('xyzzy')).toBeNull();
    expect(fuzzySuggestion('i have been thinking about maybe possibly writing a letter to the society chairman about the lift')).toBeNull();
  });

  it('never offers a suggestion for a sentence the e2e specs type or speak', () => {
    const spoken = new Set<string>();
    for (const file of readdirSync(join(root, 'e2e'))) {
      if (!file.endsWith('.spec.ts')) continue;
      const src = readFileSync(join(root, 'e2e', file), 'utf8');
      for (const m of src.matchAll(/(?:fill|speakLine|handleTranscript)\(\s*(['"])([^'"]{4,70})\1/g)) {
        spoken.add(m[2]);
      }
    }
    const checked = [...spoken].filter(askableTranscript);
    expect(checked.length).toBeGreaterThan(10);
    for (const line of checked) {
      expect(fuzzySuggestion(line), line).toBeNull();
    }
  });
});

describe('asking, then running only after a yes', () => {
  it('offers the phrase, and on “haan” runs it', async () => {
    useFeaturesStore.setState({
      fitnessLogs: [
        {
          id: 'l1',
          kind: 'expense',
          label: 'Spent ₹400 — groceries',
          amount: 400,
          currency: 'INR',
          createdAt: Date.now() - 3600_000,
          source: 'voice',
        },
      ],
    });
    const first = await handleFeatureTurn('open my expences this month');
    expect(first?.card).toMatchObject({ kind: 'message', title: 'Did you mean…?' });
    expect(first?.speak).toContain('Did you mean');
    expect(useFeaturesStore.getState().pendingIntent).toMatchObject({ text: 'open my expenses this month' });

    const yes = await handleFeatureTurn('haan');
    expect(useFeaturesStore.getState().pendingIntent).toBeNull();
    expect(yes?.messages[0].text).toContain('Ran “open my expenses this month”.');
    expect(yes?.card).toMatchObject({ kind: 'track', lens: 'expenses' });
  });
  it('on “nahi” leaves the words alone and does not run anything', async () => {
    await handleFeatureTurn('open my expences this month');
    const no = await handleFeatureTurn('nahi');
    expect(no?.speak).toMatch(/left it alone/i);
    expect(useFeaturesStore.getState().pendingIntent).toBeNull();
    expect(useFeaturesStore.getState().fitnessLogs).toHaveLength(0);
  });
  it('does not keep a question open forever', async () => {
    useFeaturesStore.getState().setPendingIntent({
      text: 'search my conversations',
      phrase: 'your saved conversations',
      askedAt: Date.now() - 600000,
    });
    const later = await handleFeatureTurn('yes');
    // A stale "yes" is not a confirmation of an old question: nothing runs.
    expect(later === null || !/Ran “search my conversations”/.test(later.messages[0]?.text || '')).toBe(true);
    expect(useFeaturesStore.getState().pendingIntent).toBeNull();
  });
  it('a normal sentence in the middle of a question cancels nothing silently', async () => {
    await handleFeatureTurn('open my expences this month');
    // An unrelated utterance is not a "yes": the question is closed, and the
    // log the user actually said is what runs.
    const other = await handleFeatureTurn('kharcha 200 chai');
    expect(other?.card).toMatchObject({ kind: 'fitness' });
    expect(useFeaturesStore.getState().pendingIntent).toBeNull();
  });
});
