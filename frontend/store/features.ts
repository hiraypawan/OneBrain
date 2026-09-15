'use client';
import { create } from 'zustand';
import { db } from '@/lib/db';
import { useAssistantStore } from './assistant';
import type { EmailSlots, EmailDraft, EmailTone } from '@/lib/email';
import type { FitnessLog } from '@/lib/fitness';
import type { WorkoutPreset, CueSchedule } from '@/lib/workout';
import type { ResearchBrief } from '@/lib/research';
import type { RangeSummary, DateRange } from '@/lib/timetravel';
import type { Minutes } from '@/lib/scribe';
import type { Commitment, BriefResult, ForgettingResult, RadarResult } from '@/lib/briefing';
import type { StoryThread } from '@/lib/story';
import type { WitnessState, WitnessAction } from '@/lib/witness';
import { INITIAL_WITNESS, witnessReducer } from '@/lib/witness';
import type { MorningDigest, NightNote } from '@/lib/nightmind';
import type { PlanId, QuotaUse } from '@/lib/plans';
import { EMPTY_QUOTA } from '@/lib/plans';

export type FeatureCard =
  | { kind: 'email'; slots: EmailSlots; draft: EmailDraft; userName: string }
  | { kind: 'fitness'; log: FitnessLog; totalsLine: string; streakLine: string }
  | { kind: 'fitness-ambiguous'; value: number; candidates: string[] }
  | { kind: 'workout' }
  | { kind: 'research'; brief: ResearchBrief }
  | { kind: 'recall'; range: DateRange; summary: RangeSummary }
  | { kind: 'persona'; id: string; name: string; tagline: string; corrections?: string }
  | { kind: 'translator'; pairId: string; lastFrom: string; lastTo: string; fromLang: string; toLang: string }
  | { kind: 'story'; thread: StoryThread; episode: string; offline: boolean }
  | { kind: 'night'; note: NightNote; count: number }
  | { kind: 'witness' }
  | { kind: 'brief'; title: string; result: BriefResult }
  | { kind: 'forgetting'; result: ForgettingResult }
  | { kind: 'followups'; result: RadarResult }
  | { kind: 'money'; dues: { title: string; detail: string }[] }
  | { kind: 'scribe'; minutes: Minutes; tasks: string[] }
  | { kind: 'digest'; digest: MorningDigest }
  | { kind: 'plan'; reason: string }
  | { kind: 'message'; title: string; body: string };

export interface EmailSession {
  slots: EmailSlots;
  awaiting: import('@/lib/email').SlotName | null;
}

export interface PersonaSession {
  id: string;
  startedAt: number;
  turns: number;
}

export interface TranslatorSession {
  pairId: string;
  startedAt: number;
  turns: number;
  lastFrom: string;
  lastTo: string;
  fromLang: string;
  toLang: string;
}

export interface StorySession {
  threadId: string;
  startedAt: number;
}

export interface WorkoutRun {
  preset: WorkoutPreset;
  schedule: CueSchedule;
  startedAt: number;
  pausedAccum: number; // ms spent paused
  pausedAt: number | null;
  spokenCues: number; // count of cues already spoken
  finished: boolean;
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

interface FeaturesState {
  ready: boolean;
  card: FeatureCard | null;
  setCard: (c: FeatureCard | null) => void;
  emailSession: EmailSession | null;
  setEmailSession: (s: EmailSession | null) => void;
  persona: PersonaSession | null;
  setPersona: (p: PersonaSession | null) => void;
  personaNotes: Record<string, string[]>;
  addPersonaNote: (id: string, note: string) => void;
  translator: TranslatorSession | null;
  setTranslator: (t: TranslatorSession | null) => void;
  story: StorySession | null;
  setStory: (s: StorySession | null) => void;
  workout: WorkoutRun | null;
  setWorkout: (w: WorkoutRun | null) => void;
  witness: WitnessState;
  witnessDispatch: (a: WitnessAction) => void;
  plan: PlanId;
  betaKey: string | null;
  usage: QuotaUse;
  unlock: (plan: PlanId, key: string) => void;
  trackUse: (patch: Partial<QuotaUse>) => void;
  commitments: Commitment[];
  addCommitment: (c: Omit<Commitment, 'id' | 'createdAt' | 'done'>) => void;
  doneCommitment: (id: string, done: boolean) => void;
  fitnessLogs: FitnessLog[];
  logFitness: (l: Omit<FitnessLog, 'id' | 'createdAt' | 'source'>, source?: FitnessLog['source']) => FitnessLog;
  removeFitnessLog: (id: string) => void;
  repairLastLog: (value: number) => FitnessLog | null;
  nightNotes: NightNote[];
  addNightNote: (text: string, tags: NightNote['tags']) => NightNote;
  stories: StoryThread[];
  saveStory: (t: StoryThread) => void;
  removeStory: (id: string) => void;
  storyCap: number;
  setStoryCap: (n: number) => void;
  emailDrafts: { id: string; subject: string; body: string; tone: string; kind: string; to?: string; toEmail?: string; createdAt: number }[];
  saveEmailDraft: (d: Omit<FeaturesState['emailDrafts'][number], 'id' | 'createdAt'>) => void;
  removeEmailDraft: (id: string) => void;
  speaker: ((text: string) => Promise<void>) | null;
  setSpeaker: (fn: ((text: string) => Promise<void>) | null) => void;
  load: () => Promise<void>;
}

const mem = () => {
  try {
    return useAssistantStore.getState().settings.memoryEnabled;
  } catch {
    return true;
  }
};

export const useFeaturesStore = create<FeaturesState>((set, get) => ({
  ready: false,
  card: null,
  setCard: (card) => set({ card }),
  emailSession: null,
  setEmailSession: (emailSession) => set({ emailSession }),
  persona: null,
  setPersona: (persona) => set({ persona }),
  personaNotes: {},
  addPersonaNote: (id, note) => {
    const list = [...(get().personaNotes[id] || []), note].slice(-20);
    set((s) => ({ personaNotes: { ...s.personaNotes, [id]: list } }));
    if (mem()) db.kv.put({ key: `persona:${id}:notes`, value: list }).catch(() => {});
  },
  translator: null,
  setTranslator: (translator) => set({ translator }),
  story: null,
  setStory: (story) => set({ story }),
  workout: null,
  setWorkout: (workout) => set({ workout }),
  witness: INITIAL_WITNESS,
  witnessDispatch: (a) => set((s) => ({ witness: witnessReducer(s.witness, a) })),
  plan: 'free',
  betaKey: null,
  usage: { ...EMPTY_QUOTA },
  unlock: (plan, key) => {
    set({ plan, betaKey: key });
    db.kv.put({ key: 'plan', value: { plan, key } }).catch(() => {});
  },
  trackUse: (patch) => {
    const usage = { ...get().usage, ...patch };
    set({ usage });
    db.kv.put({ key: 'quota', value: usage }).catch(() => {});
  },
  commitments: [],
  addCommitment: (c) => {
    const full: Commitment = { ...c, id: uuid(), createdAt: Date.now(), done: false };
    set((s) => ({ commitments: [...s.commitments, full].slice(-200) }));
    if (mem()) db.kv.put({ key: 'commitments', value: [...get().commitments] }).catch(() => {});
  },
  doneCommitment: (id, done) => {
    set((s) => ({ commitments: s.commitments.map((c) => (c.id === id ? { ...c, done } : c)) }));
    if (mem()) db.kv.put({ key: 'commitments', value: [...get().commitments] }).catch(() => {});
  },
  fitnessLogs: [],
  logFitness: (l, source = 'voice') => {
    const full: FitnessLog = { ...l, id: uuid(), createdAt: Date.now(), source };
    set((s) => ({ fitnessLogs: [...s.fitnessLogs, full].slice(-2000) }));
    if (mem()) db.fitnessLogs.put({ ...full }).catch(() => {});
    return full;
  },
  removeFitnessLog: (id) => {
    set((s) => ({ fitnessLogs: s.fitnessLogs.filter((l) => l.id !== id) }));
    db.fitnessLogs.delete(id).catch(() => {});
  },
  repairLastLog: (value) => {
    const logs = get().fitnessLogs;
    const last = [...logs].reverse().find((l) => l.kind === 'workout' || l.kind === 'expense' || l.kind === 'water' || l.kind === 'food');
    if (!last || last.qty === undefined) return null;
    const ratio = value / (last.qty || 1);
    const next: FitnessLog = {
      ...last,
      qty: value,
      label: last.label.replace(String(last.qty), String(value)),
      calories: last.calories ? Math.round(last.calories * ratio) : last.calories,
      amount: last.amount ? value : last.amount,
    };
    set((s) => ({ fitnessLogs: s.fitnessLogs.map((l) => (l.id === last.id ? next : l)) }));
    if (mem()) db.fitnessLogs.put({ ...next }).catch(() => {});
    return next;
  },
  nightNotes: [],
  addNightNote: (text, tags) => {
    const note: NightNote = { id: uuid(), text, at: Date.now(), tags };
    set((s) => ({ nightNotes: [...s.nightNotes, note].slice(-300) }));
    if (mem()) db.kv.put({ key: 'nightnotes', value: [...get().nightNotes] }).catch(() => {});
    return note;
  },
  stories: [],
  saveStory: (t) => {
    set((s) => ({ stories: [t, ...s.stories.filter((x) => x.id !== t.id)].slice(0, 50) }));
    if (mem()) db.stories.put({ ...t }).catch(() => {});
  },
  removeStory: (id) => {
    set((s) => ({ stories: s.stories.filter((x) => x.id !== id) }));
    db.stories.delete(id).catch(() => {});
  },
  storyCap: 3,
  setStoryCap: (n) => {
    const v = Math.min(20, Math.max(1, Math.floor(n) || 3));
    set({ storyCap: v });
    db.kv.put({ key: 'story:cap', value: v }).catch(() => {});
  },
  emailDrafts: [],
  saveEmailDraft: (d) => {
    const full = { ...d, id: uuid(), createdAt: Date.now() };
    set((s) => ({ emailDrafts: [full, ...s.emailDrafts].slice(0, 100) }));
    if (mem()) db.emailDrafts.put(full).catch(() => {});
  },
  removeEmailDraft: (id) => {
    set((s) => ({ emailDrafts: s.emailDrafts.filter((x) => x.id !== id) }));
    db.emailDrafts.delete(id).catch(() => {});
  },
  speaker: null,
  setSpeaker: (speaker) => set({ speaker }),
  load: async () => {
    try {
      const [planRow, quotaRow, commitRow, nightRow, notes, logs, stories, drafts, capRow] = await Promise.all([
        db.kv.get('plan'),
        db.kv.get('quota'),
        db.kv.get('commitments'),
        db.kv.get('nightnotes'),
        Promise.all(['english-tutor', 'gym-coach', 'upsc-interviewer', 'interview-coach', 'startup-mentor', 'study-buddy'].map(async (id) => [id, (await db.kv.get(`persona:${id}:notes`))?.value || []] as const)),
        db.fitnessLogs.orderBy('createdAt').toArray().catch(() => []),
        db.stories.orderBy('updatedAt').reverse().toArray().catch(() => []),
        db.emailDrafts.orderBy('createdAt').reverse().toArray().catch(() => []),
        db.kv.get('story:cap'),
      ]);
      set({
        ready: true,
        plan: (planRow?.value?.plan as PlanId) || 'free',
        betaKey: planRow?.value?.key || null,
        usage: { ...EMPTY_QUOTA, ...(quotaRow?.value || {}) },
        commitments: Array.isArray(commitRow?.value) ? commitRow.value.slice(-200) : [],
        nightNotes: Array.isArray(nightRow?.value) ? nightRow.value.slice(-300) : [],
        personaNotes: Object.fromEntries(notes),
        fitnessLogs: (logs as FitnessLog[]).slice(-2000),
        stories: (stories as StoryThread[]).slice(0, 50),
        storyCap: typeof capRow?.value === 'number' && capRow.value >= 1 && capRow.value <= 20 ? capRow.value : 3,
        emailDrafts: drafts.slice(0, 100),
      });
    } catch {
      set({ ready: true });
    }
  },
}));
