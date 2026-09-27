// Intent-router audit harness.
//
// OneBrain answers a spoken (or typed) line by walking a fixed chain of
// deterministic detectors and only falling through to the AI at the end. That
// chain is the product: when a loose regex grabs an ordinary sentence, the
// person gets a meal log instead of an answer, and nothing in the UI explains
// why. See docs/AUDIT-2026-09-27-VOICE-AND-INTENT.md for the 2026-09-27 pass
// that motivated this file.
//
// This module makes the chain *measurable*: it runs the REAL router — the same
// `processTranscript` gates followed by the real `handleFeatureTurn` — over a
// table of everyday phrases and reports which branch took each one, plus what
// it wrote or which mode it flipped. Nothing here is a copy of the router, so
// it cannot drift from it.
//
// It is a development tool, not app code: no screen imports it. It is consumed
// by `__tests__/intent-routing.test.ts` (the ratchet that fails when routing
// changes) and by `npm run audit:intents` (scripts/intent-audit.mjs).

import { useAssistantStore } from '@/store/assistant';
import { useFeaturesStore } from '@/store/features';
import { useWorkspaceStore } from '@/store/workspace';
import { handleFeatureTurn, type FeatureTurn } from '@/lib/feature-engine';
import { parseMediaCommand, parseVoiceCommand, isPauseCommand } from '@/lib/commands';
import { parseReminderIntent } from '@/lib/reminders';
import { sharedIntent } from '@/lib/shared-voice';
import { interpretLocal } from '@/lib/workspace/voice';
import { INITIAL_WITNESS } from '@/lib/witness';
import { DEFAULT_TRACK_GOALS } from '@/store/features';
import { EMPTY_QUOTA } from '@/lib/plans';

/** Coarse branch names. One per destination a turn can reach. */
export type RouteKind =
  | 'ai' // fell through the whole chain: the AI answers
  | 'did-you-mean' // fuzzy recovery question
  | 'session' // stop / pause / continue / new chat / repeat / not-you
  | 'shared' // shared (server) voice capture preview
  | 'local-answer' // calculation, day summary, memory search
  | 'capture-draft' // note/task/idea draft awaiting review
  | 'reminder'
  | 'media'
  | 'distress'
  | 'witness'
  | 'workout-session'
  | 'email'
  | 'log-repair' // rewrite the last log's amount
  | 'log-delete' // remove the last log
  | 'log-query' // deterministic answer from the device log
  | 'track' // Track navigation, budget set/read
  | 'todo'
  | 'fitness-summary'
  | 'fitness-log'
  | 'fitness-ambiguous'
  | 'translator'
  | 'scribe'
  | 'persona'
  | 'story'
  | 'night-note'
  | 'digest'
  | 'research'
  | 'recall'
  | 'brief'
  | 'plan'
  | 'message'
  // Not implemented yet — the audit expects them, so the rows stay red until
  // Phase 2 of the audit plan lands (docs/AUDIT-2026-09-27-VOICE-AND-INTENT.md).
  | 'clock'
  | 'timer';

export interface RouteResult {
  kind: RouteKind;
  /** What the branch said or did, for the printed table. */
  detail: string;
  /** Data written or mode flipped by this one turn. */
  effects: string[];
}

interface Snapshot {
  logs: number;
  lastLog: string;
  nightNotes: number;
  stories: number;
  commitments: number;
  reminders: number;
  items: number;
  persona: string | null;
  story: boolean;
  translator: string | null;
  witness: string;
  workout: string | null;
  budget: number;
  emailSession: boolean;
  pendingIntent: string | null;
}

function snapshot(): Snapshot {
  const f = useFeaturesStore.getState();
  const a = useAssistantStore.getState();
  const w = useWorkspaceStore.getState();
  const last = f.fitnessLogs[f.fitnessLogs.length - 1];
  return {
    logs: f.fitnessLogs.length,
    lastLog: last ? `${last.kind} "${last.label}"${last.amount ? ` ₹${last.amount}` : ''}` : '',
    nightNotes: f.nightNotes.length,
    stories: f.stories.length,
    commitments: f.commitments.length,
    reminders: a.reminders.length,
    items: w.items.length,
    persona: f.persona?.id || null,
    story: !!f.story,
    translator: f.translator?.pairId || null,
    witness: f.witness.phase,
    workout: f.workout ? f.workout.preset?.id || 'custom' : null,
    budget: f.trackGoals.budget || 0,
    emailSession: !!f.emailSession,
    pendingIntent: f.pendingIntent?.text || null,
  };
}

function effects(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  if (after.logs > before.logs) out.push(`wrote log ${after.lastLog}`);
  else if (after.logs === before.logs && after.lastLog !== before.lastLog && after.lastLog)
    out.push(`overwrote last log -> ${after.lastLog}`);
  if (after.nightNotes > before.nightNotes) out.push('saved night note');
  if (after.stories > before.stories) out.push('created story thread');
  if (after.commitments > before.commitments) out.push('sniffed commitment');
  if (after.reminders > before.reminders) out.push('saved reminder');
  if (after.items > before.items) out.push(`saved ${after.items - before.items} record(s)`);
  if (after.persona !== before.persona) out.push(`persona -> ${after.persona || 'off'}`);
  if (after.story !== before.story) out.push(`story mode -> ${after.story ? 'on' : 'off'}`);
  if (after.translator !== before.translator) out.push(`translator -> ${after.translator || 'off'}`);
  if (after.witness !== before.witness) out.push(`witness -> ${after.witness}`);
  if (after.workout !== before.workout) out.push(`workout -> ${after.workout || 'off'}`);
  if (after.budget !== before.budget) out.push(`budget -> ${after.budget}`);
  if (after.emailSession !== before.emailSession) out.push(`email session -> ${after.emailSession ? 'open' : 'closed'}`);
  if (after.pendingIntent !== before.pendingIntent) out.push(`pending intent -> ${after.pendingIntent || 'none'}`);
  return out;
}

/**
 * Clean slate for one phrase. Mirrors the reset `__tests__/features-engine.test.ts`
 * does, and stubs `fetch` so a route that reaches for a provider fails fast and
 * offline instead of touching the network.
 */
export async function resetAuditState(): Promise<void> {
  try {
    (globalThis as { fetch?: unknown }).fetch = () =>
      Promise.reject(new Error('offline (intent audit)'));
  } catch {}
  useFeaturesStore.setState({
    card: null,
    emailSession: null,
    persona: null,
    translator: null,
    story: null,
    workout: null,
    witness: { ...INITIAL_WITNESS, log: [] },
    plan: 'free',
    usage: { ...EMPTY_QUOTA },
    commitments: [],
    fitnessLogs: [],
    nightNotes: [],
    stories: [],
    emailDrafts: [],
    pendingIntent: null,
    trackGoals: { ...DEFAULT_TRACK_GOALS },
  });
  useAssistantStore.setState({
    messages: [],
    reminders: [],
    micNotice: null,
    isAuthenticated: false,
    user: null,
  });
  useWorkspaceStore.setState({ items: [] });
  try {
    await useFeaturesStore.getState().load();
  } catch {}
  useFeaturesStore.setState({
    plan: 'free',
    usage: { ...EMPTY_QUOTA },
    commitments: [],
    fitnessLogs: [],
    nightNotes: [],
    stories: [],
    pendingIntent: null,
  });
}

function classifyFeatureTurn(turn: FeatureTurn): { kind: RouteKind; detail: string } {
  const card = turn.card;
  const meta = turn.messages[0]?.meta || '';
  const text = turn.messages[0]?.text || turn.speak || '';
  const short = text.replace(/\s+/g, ' ').slice(0, 72);
  if (!card) return classifyTextReply(text);
  switch (card.kind) {
    case 'fitness':
      return { kind: 'fitness-log', detail: `${card.log.kind} "${card.log.label}"` };
    case 'fitness-ambiguous':
      return { kind: 'fitness-ambiguous', detail: `asked what ${card.value} means` };
    case 'track':
      // Three different branches all return a `track` card; the meta says which.
      if (meta.startsWith('Log check') || card.title.startsWith('Logged'))
        return { kind: 'log-query', detail: `${card.lens}/${card.range} · ${short}` };
      if (meta.startsWith('Fitness summary')) return { kind: 'fitness-summary', detail: short };
      return { kind: 'track', detail: `${card.title} · ${card.lens}/${card.range}` };
    case 'todo':
      return { kind: 'todo', detail: short };
    case 'brief':
      return { kind: 'brief', detail: card.title };
    case 'forgetting':
      return { kind: 'brief', detail: 'forgetting scan' };
    case 'followups':
      return { kind: 'brief', detail: 'follow-up radar' };
    case 'money':
      return { kind: 'brief', detail: `money guard (${card.dues.length} dues)` };
    case 'persona':
      return { kind: 'persona', detail: `entered ${card.id}` };
    case 'story':
      return { kind: 'story', detail: `"${card.thread.title}" episode` };
    case 'night':
      return { kind: 'night-note', detail: `saved (${card.note.tags.join(', ')})` };
    case 'digest':
      return { kind: 'digest', detail: 'morning digest' };
    case 'recall':
      return { kind: 'recall', detail: card.range.label };
    case 'research':
      return { kind: 'research', detail: `"${card.brief.query}"` };
    case 'email':
      return { kind: 'email', detail: card.draft.subject };
    case 'witness':
      return { kind: 'witness', detail: short };
    case 'workout':
      return { kind: 'workout-session', detail: short };
    case 'translator':
      return { kind: 'translator', detail: card.pairId };
    case 'scribe':
      return { kind: 'scribe', detail: `${card.tasks.length} tasks` };
    case 'plan':
      return { kind: 'plan', detail: card.reason };
    case 'message':
      if (card.title.startsWith('Did you mean')) return { kind: 'did-you-mean', detail: card.body };
      if (/^Nothing logged/.test(card.title)) return { kind: 'log-query', detail: short };
      return { kind: 'message', detail: `${card.title}: ${short}` };
    default:
      return { kind: 'message', detail: short };
  }
}

// Card-less replies are classified by what the branch said, because several
// branches (recall, the last-log repair) answer in plain text.
function classifyTextReply(text: string): { kind: RouteKind; detail: string } {
  const short = text.replace(/\s+/g, ' ').slice(0, 72);
  if (/^Fixed — last log is now/.test(short)) return { kind: 'log-repair', detail: short };
  if (/^You have not asked anything/.test(short)) return { kind: 'recall', detail: short };
  return { kind: 'message', detail: short };
}

/**
 * Run one phrase through the same deterministic gates `processTranscript`
 * walks, then the real feature router. Stateful gates that are not about
 * understanding the words (voiceprint, pending capture/shared review,
 * proactive invitations) are deliberately out of scope — they are covered by
 * their own suites.
 */
export async function routeTranscript(text: string): Promise<RouteResult> {
  const before = snapshot();

  // 1. Session controls (hooks/useAssistant.ts::handleTranscript + step 1).
  if (isPauseCommand(text))
    return finish(before, { kind: 'session', detail: 'pause' });
  const cmd = parseVoiceCommand(text);
  if (cmd) return finish(before, { kind: 'session', detail: cmd });

  // 2. Explicit shared (server) capture — "shared task: …".
  let shared = null as ReturnType<typeof sharedIntent>;
  try {
    shared = sharedIntent(text);
  } catch {}
  if (shared) return finish(before, { kind: 'shared', detail: `${shared.kind} "${shared.title}"` });

  // 3. Local structured capture + calculation + memory search.
  const local = interpretLocal(text, useWorkspaceStore.getState().items);
  if (local)
    return finish(
      before,
      local.type === 'draft'
        ? { kind: 'capture-draft', detail: local.drafts.map((d) => d.title).join('; ') }
        : { kind: 'local-answer', detail: local.text.replace(/\s+/g, ' ').slice(0, 72) },
    );

  // 4. Conversational reminders.
  const ri = parseReminderIntent(text);
  if (ri)
    return finish(before, {
      kind: 'reminder',
      detail: `"${ri.title}" @ ${ri.time}${ri.date ? ` ${ri.date}` : ' daily'}`,
    });

  // 5. Music / podcasts / video.
  const media = parseMediaCommand(text);
  if (media)
    return finish(before, {
      kind: 'media',
      detail: media.action === 'play' ? `play "${media.query}"` : media.action,
    });

  // 6. Everything else: the real feature router, or the AI when it returns null.
  try {
    const turn = await handleFeatureTurn(text);
    // null is the router saying "not mine" — the AI chain answers these.
    if (!turn) return finish(before, { kind: 'ai', detail: 'fell through to the AI chain' });
    return finish(before, classifyFeatureTurn(turn));
  } catch (error) {
    // A throwing detector is a misroute too: the person gets the AI instead of
    // the feature, and the error never reaches them.
    return finish(before, {
      kind: 'ai',
      detail: `router threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  function finish(b: Snapshot, r: { kind: RouteKind; detail: string }): RouteResult {
    return { ...r, effects: effects(b, snapshot()) };
  }
}

export interface AuditPhrase {
  text: string;
  /** Where a person saying this expects to land. */
  expect: RouteKind;
  note?: string;
}

/**
 * Everyday lines — the kind a person actually says to an assistant. The
 * documented logging phrases are in here too, so a fix that saves "2 roti
 * khayi" cannot quietly break it.
 */
export const AUDIT_PHRASES: AuditPhrase[] = [
  // Clock: the most basic questions there are. No deterministic handler exists
  // yet (audit finding I19), so these rows stay red until Phase 2 adds one.
  { text: 'what is the date today', expect: 'clock' },
  { text: "what's the date today", expect: 'clock' },
  { text: 'what is today’s date and time', expect: 'clock' },
  { text: 'what day is it today', expect: 'clock' },
  { text: 'what time is it', expect: 'clock' },
  { text: 'aaj ka din kaunsa hai', expect: 'clock' },
  { text: 'aaj ki date kya hai', expect: 'clock' },
  // Capture
  { text: 'create a task to call mom', expect: 'capture-draft' },
  { text: 'task: call mom', expect: 'capture-draft' },
  { text: 'note: buy milk', expect: 'capture-draft' },
  // Plain conversation that must reach the AI untouched
  { text: 'update my profile name', expect: 'ai' },
  { text: 'I will be late today', expect: 'ai' },
  { text: 'generate a plan for my week', expect: 'ai' },
  { text: 'translate this sentence for me', expect: 'ai' },
  { text: 'what is the price of rice today', expect: 'ai' },
  { text: 'great job on the report', expect: 'ai' },
  { text: 'how do I sleep better at night', expect: 'ai' },
  { text: 'let us do 20 pushups', expect: 'ai', note: 'a suggestion, not a log — and “do” reads as 2' },
  { text: 'I spent no time on this', expect: 'ai', note: '“no” reads as 9' },
  { text: 'what should I do to lose weight fast', expect: 'ai' },
  { text: 'I spent 2 hours on the report', expect: 'ai' },
  { text: 'this is a different problem', expect: 'ai' },
  { text: 'my parents are coming tomorrow', expect: 'ai' },
  { text: 'semi final match kab hai', expect: 'ai' },
  { text: 'remind me why we did it this way', expect: 'ai' },
  { text: 'what does this remind you of', expect: 'ai' },
  { text: 'aage batao', expect: 'ai', note: 'follow-up: keep talking about this' },
  { text: 'continue explaining the last point', expect: 'ai' },
  { text: 'aur sunao', expect: 'ai', note: 'follow-up, not a song request' },
  { text: 'revise my note about the meeting', expect: 'ai' },
  { text: 'padhai karni hai aaj', expect: 'ai' },
  { text: 'placement of the button is wrong', expect: 'ai' },
  { text: 'business idea soch raha hun', expect: 'ai' },
  { text: 'what is the suicide rate in india', expect: 'ai' },
  { text: 'news about self harm laws', expect: 'ai' },
  { text: 'track my order status', expect: 'ai' },
  { text: 'the last meeting was on monday', expect: 'ai' },
  { text: 'yeh phone best hai kya', expect: 'ai' },
  { text: 'what is under the sea', expect: 'ai' },
  { text: 'main soch raha tha ki movie dekhein', expect: 'ai' },
  // Timers: the utilities exist (lib/utilities.ts) but no spoken intent reaches
  // them yet (audit finding I20).
  { text: 'start the timer for 5 minutes', expect: 'timer' },
  { text: 'set a timer of 10 minutes', expect: 'timer' },
  { text: 'timer chalu karo', expect: 'timer' },
  // Reminders
  { text: 'remind me to buy 2 things', expect: 'ai', note: 'no time given: ask, do not guess 02:00' },
  { text: 'call mom at 5 pm', expect: 'reminder' },
  { text: 'remind me to pay rent at 9am tomorrow', expect: 'reminder' },
  // Documented logging + query phrases (must keep working)
  { text: 'kharcha 200 chai', expect: 'fitness-log' },
  { text: '2 roti khayi', expect: 'fitness-log' },
  { text: '20 pushups kar liye', expect: 'fitness-log' },
  { text: '6 ghante soya', expect: 'fitness-log' },
  { text: '8 glass paani piya', expect: 'fitness-log' },
  { text: 'energy low', expect: 'fitness-log' },
  { text: 'what expenses did I do today', expect: 'log-query' },
  { text: 'kal kitna kharcha hua', expect: 'log-query' },
  { text: 'how much did I spend this week', expect: 'log-query' },
  { text: 'how much time did I spend yesterday', expect: 'log-query' },
  { text: 'how do I track my expenses', expect: 'track', note: 'opening Track answers this' },
  { text: 'open my expenses this month', expect: 'track' },
  { text: 'fitness summary', expect: 'fitness-summary' },
  { text: 'show my open tasks', expect: 'todo' },
  { text: 'what is the current status of my task', expect: 'todo' },
  { text: 'set my monthly budget to 20000', expect: 'track' },
  { text: 'what is my budget this month', expect: 'track' },
  { text: 'open track', expect: 'track' },
  { text: 'morning brief', expect: 'brief' },
  { text: 'close my day', expect: 'brief' },
  { text: 'follow ups', expect: 'brief' },
  { text: 'money due', expect: 'brief' },
  { text: 'what did I ask yesterday', expect: 'recall' },
  { text: 'i asked about the loan last monday', expect: 'recall' },
  { text: 'compare iphone and pixel', expect: 'research' },
  { text: 'stop', expect: 'session' },
  { text: 'continue', expect: 'session' },
  { text: 'play kesariya', expect: 'media' },
  { text: '15 + 7', expect: 'local-answer', note: 'the on-device calculator, no provider' },
];

/**
 * Phrases whose routing depends on the hour. Run these with the clock pinned
 * late at night (`vi.setSystemTime`), because `isNightHour()` reads the real
 * clock inside the router.
 */
export const NIGHT_AUDIT_PHRASES: AuditPhrase[] = [
  { text: 'main soch raha tha ki movie dekhein', expect: 'ai', note: 'night gate must not swallow ordinary speech' },
  { text: 'neend nahi aa rahi', expect: 'night-note', note: 'this one IS a night note' },
  { text: 'kal exam hai tension ho rahi hai', expect: 'night-note' },
];

/**
 * Ratchet. Every row here misroutes TODAY; the value is the branch it wrongly
 * lands on. The test asserts the wrong route is still the wrong route, so
 * fixing one fails the suite until the row is deleted from this list — the
 * list can only shrink. Audit findings in brackets.
 */
export const KNOWN_MISROUTES: Record<string, RouteKind> = {
  'what is the date today': 'fitness-log', //            I1 "ate" inside "date"
  "what's the date today": 'fitness-log', //             I1
  'what is today’s date and time': 'fitness-log', //     I1
  'what day is it today': 'ai', //                       I19 no deterministic clock
  'what time is it': 'ai', //                            I19
  'aaj ka din kaunsa hai': 'ai', //                      I19
  'aaj ki date kya hai': 'fitness-log', //               I1
  'create a task to call mom': 'fitness-log', //         I1 "ate" inside "create"
  'update my profile name': 'fitness-log', //            I1
  'I will be late today': 'fitness-log', //              I1
  'generate a plan for my week': 'fitness-log', //       I1
  'translate this sentence for me': 'fitness-log', //    I1
  'how do I sleep better at night': 'fitness-log', //    I1 + I2 ("do" = 2)
  'let us do 20 pushups': 'fitness-log', //              I2 logs “2 Pushups”, the 20 is lost
  'I spent no time on this': 'fitness-log', //           I2 logs ₹9 expense
  'what should I do to lose weight fast': 'log-query', //I11
  'I spent 2 hours on the report': 'log-query', //       I11 ("report" as a question word)
  'this is a different problem': 'brief', //             I5 "rent" inside "different"
  'my parents are coming tomorrow': 'brief', //          I5 "rent" inside "parents"
  'semi final match kab hai': 'brief', //                I5 "emi" inside "semi"
  'remind me why we did it this way': 'brief', //        I5
  'what does this remind you of': 'brief', //            I5
  'aage batao': 'story', //                              I7
  'continue explaining the last point': 'story', //      I7
  'aur sunao': 'media', //                               I7
  'revise my note about the meeting': 'persona', //      I6
  'padhai karni hai aaj': 'persona', //                  I6
  'placement of the button is wrong': 'plan', //         I6 (persona branch, then its plan gate)
  'business idea soch raha hun': 'plan', //              I6
  'what is the suicide rate in india': 'night-note', //  I8 (saved as a worry, at 10:30am)
  'news about self harm laws': 'night-note', //          I8
  'track my order status': 'track', //                   I12
  'the last meeting was on monday': 'recall', //         I13
  'yeh phone best hai kya': 'research', //               I14
  'start the timer for 5 minutes': 'ai', //              I20
  'set a timer of 10 minutes': 'ai', //                  I20
  'timer chalu karo': 'workout-session', //              I15
  'remind me to buy 2 things': 'reminder', //            I9 (saves 02:00)
  'call mom at 5 pm': 'ai', //                           I9 gap
  'open my expenses this month': 'log-query', //         D1
  'close my day': 'local-answer', //                     D2
};

/** The night-hours rows, pinned with a fake clock by the test. */
export const KNOWN_NIGHT_MISROUTES: Record<string, RouteKind> = {
  'main soch raha tha ki movie dekhein': 'night-note', // I10
  // I10b: the night keyword list has “tension hai” but not “tension ho rahi”,
  // so the one hour a person most needs the night note is the hour it misses.
  'kal exam hai tension ho rahi hai': 'ai',
};

export interface AuditRow {
  /** Stable ratchet key: the phrase, or `seed → phrase` for the scenario table. */
  key: string;
  text: string;
  expect: RouteKind;
  got: RouteKind;
  detail: string;
  effects: string[];
  known: boolean;
  ok: boolean;
}

/**
 * Phrases that only misroute when a log already exists — the "fix the last
 * entry" branch. A fresh store hides it, so these run against a seeded one.
 */
export interface AuditScenario {
  /** Phrase that writes the log first. */
  seed: string;
  text: string;
  expect: RouteKind;
  note?: string;
}

export const REPAIR_SCENARIOS: AuditScenario[] = [
  // Corrections that work today — a fix must not break these.
  { seed: 'kharcha 200 chai', text: 'wrong, it was 10', expect: 'log-repair' },
  { seed: '2 roti khayi', text: 'nahi maine 3 roti khayi', expect: 'log-repair' },
  // False positives: rewrite the last log with no confirmation (audit I3).
  { seed: 'kharcha 200 chai', text: 'change 5', expect: 'ai', note: 'bare “change 5” should ask, not rewrite ₹200 → ₹5' },
  { seed: 'kharcha 200 chai', text: 'yeh galat hai 2 baar bolna pada', expect: 'ai', note: '“2” came from “2 baar”' },
  { seed: '2 roti khayi', text: 'pichla entry hata do', expect: 'log-delete', note: 'a delete request claims “Fixed” and changes nothing' },
  // False negatives: the obvious English corrections fall through to the AI (audit I3b).
  { seed: '6 ghante soya', text: 'not 6, it was 8', expect: 'log-repair' },
  { seed: 'kharcha 200 chai', text: 'it was 500 not 200', expect: 'log-repair' },
  { seed: '2 roti khayi', text: 'actually 4 roti', expect: 'log-repair' },
  { seed: 'kharcha 200 chai', text: 'aaj ka kharcha 500 tha', expect: 'log-repair' },
  { seed: 'kharcha 200 chai', text: 'undo that', expect: 'log-delete' },
];

/** Ratchet for the seeded table. Keyed `seed → phrase`. */
export const KNOWN_REPAIR_MISROUTES: Record<string, RouteKind> = {
  'kharcha 200 chai → change 5': 'log-repair',
  'kharcha 200 chai → yeh galat hai 2 baar bolna pada': 'log-repair',
  '2 roti khayi → pichla entry hata do': 'log-repair',
  '6 ghante soya → not 6, it was 8': 'ai',
  'kharcha 200 chai → it was 500 not 200': 'ai',
  '2 roti khayi → actually 4 roti': 'ai',
  'kharcha 200 chai → aaj ka kharcha 500 tha': 'log-query',
  'kharcha 200 chai → undo that': 'ai',
};

export interface AuditReport {
  rows: AuditRow[];
  total: number;
  correct: number;
  misrouted: number;
  /** Misroutes that wrote data or flipped a mode — the ones that hurt most. */
  destructive: number;
  unexpected: AuditRow[];
}

async function audit(
  phrases: AuditPhrase[],
  known: Record<string, RouteKind>,
): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (const p of phrases) {
    await resetAuditState();
    const r = await routeTranscript(p.text);
    rows.push({
      key: p.text,
      text: p.text,
      expect: p.expect,
      got: r.kind,
      detail: r.detail,
      effects: r.effects,
      known: p.text in known,
      ok: r.kind === p.expect,
    });
  }
  return rows;
}

/** Run the whole table. Used by the test and by `npm run audit:intents`. */
export async function runAudit(): Promise<AuditReport> {
  const rows = await audit(AUDIT_PHRASES, KNOWN_MISROUTES);
  const correct = rows.filter((r) => r.ok).length;
  const destructive = rows.filter((r) => !r.ok && r.effects.length > 0).length;
  return {
    rows,
    total: rows.length,
    correct,
    misrouted: rows.length - correct,
    destructive,
    // Anything misrouted that is NOT on the known list is a new regression.
    unexpected: rows.filter((r) => !r.ok && !r.known),
  };
}

/** Run the hour-dependent rows with the caller's clock already pinned. */
export async function runNightAudit(): Promise<AuditRow[]> {
  return audit(NIGHT_AUDIT_PHRASES, KNOWN_NIGHT_MISROUTES);
}

/** Run the seeded "fix the last log" rows. */
export async function runRepairAudit(): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  for (const s of REPAIR_SCENARIOS) {
    await resetAuditState();
    await routeTranscript(s.seed);
    const before = snapshot();
    const r = await routeTranscript(s.text);
    rows.push({
      key: `${s.seed} → ${s.text}`,
      text: s.text,
      expect: s.expect,
      got: r.kind,
      detail: r.detail,
      effects: effects(before, snapshot()),
      known: `${s.seed} → ${s.text}` in KNOWN_REPAIR_MISROUTES,
      ok: r.kind === s.expect,
    });
  }
  return rows;
}
