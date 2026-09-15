import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFeatureTurn, observeTranscript } from '../lib/feature-engine';
import { useFeaturesStore } from '../store/features';
import { useAssistantStore } from '../store/assistant';
import { INITIAL_WITNESS } from '../lib/witness';
import { EMPTY_QUOTA, mintBetaKey } from '../lib/plans';

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

describe('witness mode', () => {
  it('starts, logs, safes and stops', async () => {
    const start = await handleFeatureTurn('witness mode on');
    expect(start?.card).toMatchObject({ kind: 'witness' });
    observeTranscript('auto mein hun');
    expect(useFeaturesStore.getState().witness.log.length).toBeGreaterThan(1);
    const safe = await handleFeatureTurn('safe');
    expect(safe?.speak).toMatch(/nazar/);
    const stop = await handleFeatureTurn('stop witness');
    expect(useFeaturesStore.getState().witness.phase).toBe('idle');
    expect(stop?.speak).toMatch(/off/);
  });
  it('ignores safe when idle', async () => {
    expect(await handleFeatureTurn('safe')).toBeNull();
  });
});

describe('email drafter', () => {
  it('runs the full slot-fill to draft', async () => {
    const q1 = await handleFeatureTurn('meri leave application likh do');
    expect(q1?.speak).toMatch(/Kisko/);
    const q2 = await handleFeatureTurn('mere manager Ramesh');
    expect(q2?.speak).toMatch(/Kitne din/);
    const q3 = await handleFeatureTurn('do din');
    expect(q3?.speak).toMatch(/Kab se/);
    const q4 = await handleFeatureTurn('kal se');
    expect(q4?.speak).toMatch(/Wajah/);
    const done = await handleFeatureTurn('bukhar hai');
    expect(done?.card).toMatchObject({ kind: 'email' });
    if (done?.card?.kind === 'email') {
      expect(done.card.draft.subject).toMatch(/Leave Application/);
      expect(done.card.draft.body).toMatch(/Ramesh/);
    }
  });
  it('cancels cleanly', async () => {
    await handleFeatureTurn('leave application likh do');
    const c = await handleFeatureTurn('cancel email');
    expect(c?.speak).toMatch(/Discarded/);
    expect(useFeaturesStore.getState().emailSession).toBeNull();
  });
});

describe('fitness logging', () => {
  it('logs workouts and confirms with streaks', async () => {
    const r = await handleFeatureTurn('20 pushups kar liye');
    expect(r?.card).toMatchObject({ kind: 'fitness' });
    expect(useFeaturesStore.getState().fitnessLogs).toHaveLength(1);
    expect(r?.speak).toMatch(/Logged/);
  });
  it('asks on ambiguity, then resolves', async () => {
    const q = await handleFeatureTurn('200');
    expect(q?.card).toMatchObject({ kind: 'fitness-ambiguous' });
    const r = await handleFeatureTurn('pushups');
    expect(r?.card).toMatchObject({ kind: 'fitness' });
  });
  it('repairs the last log', async () => {
    await handleFeatureTurn('20 pushups kar liye');
    const r = await handleFeatureTurn('change last log to 60');
    expect(r?.speak).toMatch(/60 Pushups/);
  });
  it('summarizes fitness', async () => {
    await handleFeatureTurn('kharcha 200 chai');
    const r = await handleFeatureTurn('fitness summary');
    expect(r?.speak).toMatch(/kharcha|₹200/);
  });
});

describe('workout timer', () => {
  it('starts, pauses, resumes and stops', async () => {
    const s = await handleFeatureTurn('tabata shuru karo');
    expect(s?.card).toEqual({ kind: 'workout' });
    expect(useFeaturesStore.getState().workout?.preset.id).toBe('tabata');
    await handleFeatureTurn('pause workout');
    expect(useFeaturesStore.getState().workout?.pausedAt).toBeTruthy();
    await handleFeatureTurn('resume workout');
    expect(useFeaturesStore.getState().workout?.pausedAt).toBeNull();
    await handleFeatureTurn('stop workout');
    expect(useFeaturesStore.getState().workout).toBeNull();
  });
});

describe('translator', () => {
  it('enters, translates offline phrases, exits', async () => {
    const e = await handleFeatureTurn('translator mode on');
    expect(e?.card).toMatchObject({ kind: 'translator' });
    const t = await handleFeatureTurn('yeh kitne ka hai');
    expect(t?.speak).toBe('How much is this?');
    const x = await handleFeatureTurn('translator band');
    expect(x?.speak).toMatch(/off/);
    expect(useFeaturesStore.getState().translator).toBeNull();
  });
});

describe('personas', () => {
  it('tutors offline with corrections', async () => {
    await handleFeatureTurn('correct my English');
    expect(useFeaturesStore.getState().persona?.id).toBe('english-tutor');
    const t = await handleFeatureTurn('it is more better');
    expect(t?.speak).toMatch(/Better/);
    await handleFeatureTurn('exit mode');
    expect(useFeaturesStore.getState().persona).toBeNull();
  });
  it('gates pro personas on free', async () => {
    const r = await handleFeatureTurn('UPSC interview lo');
    expect(r?.card).toMatchObject({ kind: 'plan' });
    expect(useFeaturesStore.getState().persona).toBeNull();
  });
  it('coaches offline', async () => {
    await handleFeatureTurn('be my strict gym coach');
    const t = await handleFeatureTurn('how to do pushups?');
    expect(t?.speak).toMatch(/Pushups/);
  });
});

describe('story mode', () => {
  it('tells an offline episode and continues', async () => {
    const e = await handleFeatureTurn('kahani sunao');
    expect(e?.card).toMatchObject({ kind: 'story' });
    if (e?.card?.kind === 'story') expect(e.card.offline).toBe(true);
    const c = await handleFeatureTurn('aage sunao');
    expect(c?.card).toMatchObject({ kind: 'story' });
    await handleFeatureTurn('kahani band');
    expect(useFeaturesStore.getState().story).toBeNull();
  });
});

describe('night notes', () => {
  it('captures and digests', async () => {
    const n = await handleFeatureTurn('night note: kal presentation ka tension hai');
    expect(n?.card).toMatchObject({ kind: 'night' });
    useFeaturesStore.setState({
      nightNotes: useFeaturesStore.getState().nightNotes.map((x) => ({ ...x, at: Date.now() - 3600000 })),
    });
    // Force the note into last-night window by direct digest compile path.
    const d = await handleFeatureTurn('morning digest');
    expect(d?.card).toMatchObject({ kind: 'digest' });
  });
  it('responds supportively to distress', async () => {
    const r = await handleFeatureTurn('jeene ka mann nahi kar raha');
    expect(r?.speak).toMatch(/14416/);
  });
});

describe('briefs and radar', () => {
  it('compiles briefs from local data', async () => {
    observeTranscript("I'll send the quote by Tuesday");
    expect(useFeaturesStore.getState().commitments).toHaveLength(1);
    const m = await handleFeatureTurn('morning brief');
    expect(m?.card).toMatchObject({ kind: 'brief' });
    const c = await handleFeatureTurn('close my day');
    expect(c?.card).toMatchObject({ kind: 'brief' });
    const fq = await handleFeatureTurn('what am i forgetting');
    expect(fq?.card).toMatchObject({ kind: 'forgetting' });
    const fu = await handleFeatureTurn('follow ups');
    expect(fu?.card).toMatchObject({ kind: 'followups' });
    const money = await handleFeatureTurn('money due batao');
    expect(money?.card).toMatchObject({ kind: 'money' });
  });
  it('answers recovery from logs', async () => {
    await handleFeatureTurn('4 ghante soya');
    const r = await handleFeatureTurn('recovery');
    expect(r?.speak).toMatch(/light day/);
  });
});

describe('scribe', () => {
  it('extracts minutes from direct text', async () => {
    const r = await handleFeatureTurn('scribe: We decided to launch Monday. Rahul will send the quote by Friday.');
    expect(r?.card).toMatchObject({ kind: 'scribe' });
    expect(r?.speak).toMatch(/Minutes ready/);
  });
  it('collects in scribe mode', async () => {
    await handleFeatureTurn('scribe mode');
    await handleFeatureTurn('Rahul will call the bank tomorrow.');
    const r = await handleFeatureTurn('scribe done');
    expect(r?.card).toMatchObject({ kind: 'scribe' });
  });
});

describe('recall', () => {
  it('quotes the last question asked', async () => {
    useAssistantStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: 'what is UPI?', createdAt: Date.now() - 5000 },
        { id: 'a1', role: 'assistant', content: 'UPI is payments.', createdAt: Date.now() - 4000 },
      ],
    });
    const r = await handleFeatureTurn('what did I ask?');
    expect(r?.speak).toMatch(/what is UPI/);
  });
  it('is honest about empty days', async () => {
    const r = await handleFeatureTurn('kal maine kya poocha');
    expect(r?.speak).toMatch(/don't have anything/);
  });
});

describe('research', () => {
  it('stays honest with no sources', async () => {
    const r = await handleFeatureTurn('EV scooters under 1.5L research karo');
    expect(r?.card).toMatchObject({ kind: 'research' });
    if (r?.card?.kind === 'research') expect(r.card.brief.grounded).toBe(false);
  });
});

describe('plan and unlock', () => {
  it('shows plan and unlocks with a beta key', async () => {
    const p = await handleFeatureTurn('my plan');
    expect(p?.card).toMatchObject({ kind: 'plan' });
    const key = mintBetaKey('pro');
    const u = await handleFeatureTurn(`unlock ${key}`);
    expect(u?.speak).toMatch(/Pro unlocked/);
    expect(useFeaturesStore.getState().plan).toBe('pro');
  });
  it('rejects bad keys', async () => {
    const u = await handleFeatureTurn('unlock WRONG-KEY');
    expect(u?.card).toMatchObject({ kind: 'plan' });
    expect(useFeaturesStore.getState().plan).toBe('free');
  });
});

describe('fallthrough', () => {
  it('returns null for generic chat', async () => {
    expect(await handleFeatureTurn('what is the capital of France?')).toBeNull();
    expect(await handleFeatureTurn('tell me a joke')).toBeNull();
  });
});
