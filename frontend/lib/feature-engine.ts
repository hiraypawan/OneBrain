// Master feature router: every voice/typed turn passes through here BEFORE
// the generic AI fallback. Returns a structured turn (messages + spoken
// reply + UI card) or null to fall through to existing handlers.
// Side effects (store/db writes) happen here; message display + speech
// stay in the hook. observeTranscript() runs for ALL turns (witness log +
// passive commitment sniffing).

import { useAssistantStore } from '@/store/assistant';
import { useWorkspaceStore } from '@/store/workspace';
import { useFeaturesStore, type FeatureCard } from '@/store/features';
import { askBrain, isLiveAnswer } from './brain';
import { fetchWikipedia } from './knowledge';
import {
  detectEmailIntent, extractEmailSlots, missingSlots, slotQuestion,
  fillSlotFromAnswer, buildDraft, retone, mailtoHref, draftSpokenSummary,
  type EmailSlots, type EmailTone, type EmailKind,
} from './email';
import {
  parseFitnessLog, resolveAmbiguous, dayTotals, dayKey, computeStreaks,
  recoveryLine, spokenConfirm, detectLogRepair, formatLogLine, type FitnessLog,
} from './fitness';
import {
  detectWorkoutIntent, presetById, customPreset, buildCues, PRESETS,
} from './workout';
import {
  detectResearchIntent, planEntitySearches, parseSynthesis, ungroundedBrief,
  RESEARCH_SYSTEM, type ResearchSource,
} from './research';
import {
  parseDateRef, detectRecallIntent, summarizeRange, formatCitation,
} from './timetravel';
import {
  detectPersonaIntent, personaById, personaPrompt, offlineTutorCorrections,
  formatCorrections, offlineCoachReply, extractModeNote,
} from './personas';
import {
  detectTranslatorIntent, detectLang, translationPrompt, TRANSLATE_SYSTEM,
  offlineTranslate, pairById, LANG_NAMES,
} from './translate';
import {
  detectStoryIntent, episodePrompt, parseStoryState, offlineEpisode,
  episodesToday, storySpokenIntro, titleFromLine, BEDTIME_CAP,
  TRIAL_EPISODES, type StoryThread, type AgeBand,
} from './story';
import {
  classifyNightNote, detectNightIntent, compileMorningDigest, lastNightWindow,
  distressCheck, SUPPORTIVE_REPLY, isNightHour,
} from './nightmind';
import {
  detectWitnessIntent,
} from './witness';
import {
  detectCommitment, detectBriefIntent, compileMorningBrief, compileCloseDay,
  forgettingScan, followupRadar, moneyDue, todayKey,
  type BriefData,
} from './briefing';
import { detectScribeIntent, extractMinutes, minutesToTasks, spokenMinutes } from './scribe';
import { planAllows, quotaMessage, FREE_LIMITS } from './plans';

export interface FeatureTurn {
  messages: { text: string; meta?: string }[];
  speak: string;
  card?: FeatureCard | null;
}

/** Passive observation for every turn. Never blocks the main flow. */
export function observeTranscript(transcript: string): void {
  try {
    const f = useFeaturesStore.getState();
    if (f.witness.phase === 'active') {
      f.witnessDispatch({ type: 'log', at: Date.now(), text: transcript.slice(0, 300) });
    }
    const mem = useAssistantStore.getState().settings.memoryEnabled;
    if (!mem) return;
    const c = detectCommitment(transcript);
    if (c) {
      const dup = f.commitments.some(
        (x) => !x.done && x.text.toLowerCase() === c.text.toLowerCase() && Date.now() - x.createdAt < 3600000,
      );
      if (!dup) {
        f.addCommitment(c);
        useAssistantStore.getState().setMicNotice('Noted a promise — I’ll remind you. Say “follow ups” anytime.');
        setTimeout(() => {
          try {
            const st = useAssistantStore.getState();
            if (st.micNotice?.startsWith('Noted a promise')) st.setMicNotice(null);
          } catch { /* noop */ }
        }, 6000);
      }
    }
  } catch { /* observation never breaks the turn */ }
}

// --- Scribe capture buffer (session-local) ---
let scribeBuffer: string[] | null = null;
let lastBriefQuery = '';

function monthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}`;
}

function priority(): boolean {
  return useFeaturesStore.getState().plan !== 'free';
}

function userName(): string {
  const u = useAssistantStore.getState().user;
  return u?.displayName || 'there';
}

function briefData(): BriefData {
  const a = useAssistantStore.getState();
  const w = useWorkspaceStore.getState();
  const f = useFeaturesStore.getState();
  const now = Date.now();
  const tasks = w.items.filter((i) => i.kind === 'task' && i.status === 'active');
  const overdue = tasks.filter((i) => i.due && new Date(i.due).getTime() < now);
  const tk = todayKey();
  const doneToday = w.items
    .filter((i) => i.kind === 'task' && i.status === 'done' && dayKey(i.updatedAt || i.createdAt) === tk)
    .map((i) => i.title);
  const fit = f.fitnessLogs;
  const threeDaysAgo = now - 3 * 86400000;
  const workoutsLast3Days = fit.filter((l) => l.kind === 'workout' && l.createdAt >= threeDaysAgo).length;
  const today = fit.filter((l) => dayKey(l.createdAt) === tk);
  const sleep = today.find((l) => l.kind === 'sleep' && l.qty);
  const energy = [...today].reverse().find((l) => l.kind === 'energy' && l.detail);
  const spendToday = today.filter((l) => l.kind === 'expense').reduce((s, l) => s + (l.amount || l.qty || 0), 0);
  const { start, end } = lastNightWindow();
  const nightCount = f.nightNotes.filter((n) => n.at >= start && n.at <= end).length;
  return {
    reminders: a.reminders.filter((r) => r.active).map((r) => ({ title: r.title, time: r.time, date: r.date })),
    openTasks: tasks.map((t) => ({ title: t.title, due: t.due })),
    overdueTasks: overdue.map((t) => ({ title: t.title, due: t.due })),
    doneToday,
    commitments: f.commitments,
    moneyDue: moneyDue(
      a.reminders.filter((r) => r.active).map((r) => ({ title: r.title, time: r.time, date: r.date })),
      w.items.map((i) => ({ title: i.title, body: i.body, due: i.due, kind: i.kind, status: i.status })),
    ),
    nightCount,
    fitness: { sleepHrs: sleep?.qty, energy: energy?.detail, workoutsLast3Days, spendToday },
    userName: a.user?.displayName,
  };
}

function depthGate<T extends { createdAt: number }>(rows: T[]): { rows: T[]; gated: boolean } {
  const plan = useFeaturesStore.getState().plan;
  if (planAllows(plan, 'unlimited-memory')) return { rows, gated: false };
  const cutoff = Date.now() - FREE_LIMITS.recallDays * 86400000;
  return { rows: rows.filter((r) => r.createdAt >= cutoff), gated: true };
}

export async function handleFeatureTurn(transcript: string): Promise<FeatureTurn | null> {
  const text = String(transcript || '').trim();
  if (!text) return null;
  const f = useFeaturesStore.getState();

  // 0. Distress always wins (except witness safe/stop handled in witness block).
  const wit0 = detectWitnessIntent(text);
  if (wit0 && (wit0.action === 'safe' || wit0.action === 'stop')) {
    // handled below
  } else if (distressCheck(text)) {
    const note = f.addNightNote(text.slice(0, 500), ['worry']);
    return {
      messages: [{ text: SUPPORTIVE_REPLY, meta: 'Support · saved privately as a night note' }],
      speak: SUPPORTIVE_REPLY,
      card: { kind: 'night', note, count: 1 },
    };
  }

  // 1. Witness / safety.
  if (wit0) {
    if (wit0.action === 'contact') {
      f.witnessDispatch({ type: 'set-contact', name: wit0.name, phone: wit0.phone || f.witness.contactPhone });
      const msg = wit0.phone
        ? `Emergency contact set: ${wit0.name}, ${wit0.phone}.`
        : `Emergency contact name set: ${wit0.name}. Add a phone number in the witness card.`;
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'witness' } };
    }
    if (wit0.action === 'safe') {
      if (f.witness.phase === 'idle') return null;
      f.witnessDispatch({ type: 'responded', at: Date.now() });
      const msg = 'Theek hai — main nazar rakh raha hun. “Witness mode band” bolo jab safe pohoch jao.';
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'witness' } };
    }
    if (wit0.action === 'stop') {
      if (f.witness.phase === 'idle') return null;
      f.witnessDispatch({ type: 'stop' });
      const n = f.witness.log.filter((e) => e.kind === 'transcript').length;
      const msg = `Witness mode off. ${n} timestamped note${n === 1 ? '' : 's'} kept on this device — export them from the card before it closes. Khayal rakhna!`;
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'witness' } };
    }
    // start
    f.witnessDispatch({ type: 'start', at: Date.now(), intervalSec: wit0.intervalSec });
    const msg = `Witness mode ON. Main sun raha hun aur har ${Math.round((wit0.intervalSec || 180) / 60)} minute mein poochunga “sab theek?”. Jawab na mile to alert card khul jayega. Safe pohoch kar “witness band” bol dena.`;
    return {
      messages: [{ text: msg, meta: 'Safety · on-device transcript · free forever' }],
      speak: msg,
      card: { kind: 'witness' },
    };
  }

  // 2. Workout controls + start.
  const wIntent = detectWorkoutIntent(text);
  if (wIntent) {
    const run = useFeaturesStore.getState().workout;
    if (wIntent.kind === 'control') {
      if (!run) return null;
      const now = Date.now();
      if (wIntent.action === 'pause' && !run.pausedAt && !run.finished) {
        f.setWorkout({ ...run, pausedAt: now });
        return { messages: [{ text: 'Workout paused. Bolo “resume workout” jab taiyaar ho.' }], speak: 'Paused. Saans lo!' };
      }
      if (wIntent.action === 'resume' && run.pausedAt) {
        f.setWorkout({ ...run, pausedAccum: run.pausedAccum + (now - run.pausedAt), pausedAt: null });
        return { messages: [{ text: 'Workout resumed!' }], speak: 'Wapas! GO!' };
      }
      if (wIntent.action === 'stop') {
        f.setWorkout(null);
        const msg = 'Workout stopped. Kuch kiya wahi jeet hai — kal phir!';
        return { messages: [{ text: msg }], speak: msg, card: null };
      }
      if (wIntent.action === 'skip') {
        const elapsed = (now - run.startedAt - run.pausedAccum) / 1000;
        const ahead = run.schedule.cues.filter((c) => c.atSec > elapsed + 1);
        const nextGo = ahead.find((c) => c.kind === 'go' || c.kind === 'start');
        const jumpTo = nextGo ? nextGo.atSec : run.schedule.totalSec;
        f.setWorkout({
          ...run,
          startedAt: run.startedAt - (jumpTo - elapsed) * 1000,
          spokenCues: run.schedule.cues.filter((c) => c.atSec <= jumpTo).length,
        });
        return { messages: [{ text: 'Skipped ahead!' }], speak: nextGo ? nextGo.text : 'Almost done!' };
      }
      return null;
    }
    // start
    if (run && !run.finished) {
      const msg = 'A workout is already running. Bolo “stop workout” pehle, phir naya shuru karenge.';
      return { messages: [{ text: msg }], speak: msg };
    }
    const preset = wIntent.kind === 'preset'
      ? presetById(wIntent.id)
      : customPreset(wIntent.workSec, wIntent.restSec, wIntent.rounds);
    if (!preset) return null;
    const schedule = buildCues(preset);
    f.setWorkout({ preset, schedule, startedAt: Date.now(), pausedAccum: 0, pausedAt: null, spokenCues: 0, finished: false });
    const msg = `${preset.name} shuru! ${preset.rounds.length} rounds. Awaz par chalo — pause ke liye “pause workout”, skip ke liye “skip”.`;
    return {
      messages: [{ text: msg, meta: 'HIIT timer · spoken cues · auto-logs on finish' }],
      speak: `${preset.name} shuru! Taiyaar? 3, 2, 1, GO!`,
      card: { kind: 'workout' },
    };
  }

  // 3. Email: cancel / tone change / slot-fill / new.
  if (/^(cancel (email|mail|draft)|email cancel|mail rehne do)$/i.test(text.trim()) && f.emailSession) {
    f.setEmailSession(null);
    return { messages: [{ text: 'Email draft discarded.' }], speak: 'Discarded. Kuch aur?' };
  }
  const toneM = text.match(/make it (formal|friendly|hinglish)|(formal|friendly|hinglish) (tone|mein|me|karo)/i);
  if (toneM && f.card?.kind === 'email') {
    const tone = (toneM[1] || toneM[2]).toLowerCase() as EmailTone;
    const card = f.card;
    const draft = retone(card.draft, tone, card.slots, card.userName);
    const next: FeatureCard = { ...card, draft };
    return {
      messages: [{ text: `Tone changed to ${tone}. Review the updated draft.` }],
      speak: `Done — ${tone} tone mein taiyaar hai.`,
      card: next,
    };
  }
  if (f.emailSession?.awaiting) {
    const slot = f.emailSession.awaiting;
    const filled = fillSlotFromAnswer(slot, text);
    if (!filled) {
      const q = `${slotQuestion(slot, f.emailSession.slots.kind)} (Dobara bolo — ya “cancel email” bolo.)`;
      return { messages: [{ text: q }], speak: q };
    }
    const slots = { ...f.emailSession.slots, ...filled };
    const miss = missingSlots(slots);
    if (miss.length) {
      f.setEmailSession({ slots, awaiting: miss[0] });
      const q = slotQuestion(miss[0], slots.kind);
      return { messages: [{ text: q }], speak: q };
    }
    return finishEmail(slots);
  }
  const emailKind: EmailKind | null = detectEmailIntent(text);
  if (emailKind) {
    const slots: EmailSlots = {
      kind: emailKind, tone: 'formal', userName: userName(),
      ...extractEmailSlots(text),
    };
    const miss = missingSlots(slots);
    if (!miss.length) return finishEmail(slots);
    f.setEmailSession({ slots, awaiting: miss[0] });
    const q = slotQuestion(miss[0], slots.kind);
    return { messages: [{ text: q, meta: 'Email drafter · I fill gaps by asking, never by guessing' }], speak: q };
  }
  if (/^(open gmail|send via gmail|mail app kholo|gmail kholo)/i.test(text.trim()) && f.card?.kind === 'email') {
    const href = mailtoHref(f.card.draft);
    try {
      if (typeof window !== 'undefined') window.location.href = href;
    } catch { /* noop */ }
    const msg = 'Opening your mail app with the draft pre-filled. Review and hit send there — I never send by myself.';
    return { messages: [{ text: msg }], speak: msg };
  }

  // 4. Fitness: repair / ambiguous resolution / log / summary.
  const repair = detectLogRepair(text);
  if (repair !== null) {
    const fixed = f.repairLastLog(repair);
    if (fixed) {
      const msg = `Fixed — last log is now ${fixed.label}.`;
      return { messages: [{ text: msg }], speak: msg };
    }
  }
  if (f.card?.kind === 'fitness-ambiguous') {
    const resolved = resolveAmbiguous(f.card.value, text);
    if (resolved.status === 'ok') {
      return saveFitnessLog(resolved.log, 'voice');
    }
    const msg = `${f.card.value} kya hai — pushups, rupaye (kharcha), paani, ya khana? Ek shabd bolo.`;
    return { messages: [{ text: msg }], speak: msg };
  }
  if (/(aaj ka )?(fitness|workout|kharcha|health) (summary|hisab|total|report)|fitness summary|meri progress/.test(text.toLowerCase())) {
    return fitnessSummary();
  }
  // 4b. Logged-data questions ("what expenses did I do yesterday", "kal
  // kitna kharcha", "how much did I spend this week"): answered
  // deterministically from the device fitness log — never guessed by AI.
  // Must run BEFORE parseFitnessLog so a question is never mis-logged.
  if (detectFitnessRangeQuery(text)) {
    return fitnessRangeTurn(text);
  }
  const fit = parseFitnessLog(text);
  if (fit.status === 'ok') {
    return saveFitnessLog(fit.log, 'voice');
  }
  if (fit.status === 'ambiguous') {
    const ambCard: FeatureCard = { kind: 'fitness-ambiguous', value: fit.value, candidates: fit.candidates };
    f.setCard(ambCard);
    const msg = `${fit.value} samjha — lekin kya? Pushups, rupaye kharcha, ya paani ke glass?`;
    return {
      messages: [{ text: msg, meta: 'One-word answer works: “pushups”, “rupaye”, “paani”…' }],
      speak: msg,
      card: ambCard,
    };
  }

  // 5. Translator mode.
  const tIntent = detectTranslatorIntent(text);
  const trans = useFeaturesStore.getState().translator;
  if (tIntent?.action === 'exit' || (trans && /^(band|stop|exit|khatam)$/i.test(text.trim()) && text.trim().length < 12)) {
    if (!trans && !tIntent) return null;
    if (tIntent?.action === 'exit' && !trans) return null;
    f.setTranslator(null);
    const msg = 'Translator off. Wapas normal baat karte hain!';
    return { messages: [{ text: msg }], speak: msg, card: null };
  }
  if (tIntent?.action === 'swap' && trans) {
    const pair = pairById(trans.pairId);
    const flipped = pairById(pair.id); // pairs are bidirectional; swap = same pair
    f.setTranslator({ ...trans, pairId: flipped.id });
    const msg = `Languages swapped — ab ${flipped.label}.`;
    return { messages: [{ text: msg }], speak: msg };
  }
  if (tIntent?.action === 'pair') {
    f.setTranslator({
      pairId: tIntent.id, startedAt: Date.now(), turns: 0, lastFrom: '', lastTo: '', fromLang: '', toLang: '',
    });
    const msg = `Translator on — ${pairById(tIntent.id).label}. Bolo, main turant translate karunga. Band karne ke liye “translator band”.`;
    return { messages: [{ text: msg, meta: 'Live translation · both sides spoken aloud' }], speak: msg, card: { kind: 'translator', pairId: tIntent.id, lastFrom: '', lastTo: '', fromLang: '', toLang: '' } };
  }
  if (tIntent?.action === 'enter' && !trans) {
    f.setTranslator({ pairId: 'hi-en', startedAt: Date.now(), turns: 0, lastFrom: '', lastTo: '', fromLang: '', toLang: '' });
    const msg = 'Translator on — Hindi ⇄ English. Bolo, main turant translate karunga. “Hindi to Marathi” bolo to pair badal dunga; “translator band” se exit.';
    return { messages: [{ text: msg, meta: 'Live translation · both sides spoken aloud' }], speak: msg, card: { kind: 'translator', pairId: 'hi-en', lastFrom: '', lastTo: '', fromLang: '', toLang: '' } };
  }
  if (trans) {
    return translateTurn(text, trans);
  }

  // 6. Persona mode.
  const pIntent = detectPersonaIntent(text);
  const persona = useFeaturesStore.getState().persona;
  if (pIntent?.action === 'exit') {
    if (!persona) return null;
    f.setPersona(null);
    const msg = 'Mode off — wapas normal OneBrain. Badhiya session tha!';
    return { messages: [{ text: msg }], speak: msg, card: null };
  }
  if (pIntent?.action === 'enter') {
    const def = personaById(pIntent.id);
    if (!def) return null;
    if (!def.free && !planAllows(f.plan, 'persona-pro')) {
      const msg = quotaMessage('persona', f.plan);
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: `persona:${def.id}` } };
    }
    f.setPersona({ id: def.id, startedAt: Date.now(), turns: 0 });
    const hello = def.id === 'english-tutor'
      ? 'Hello! I am your English tutor. Speak anything in English — I will gently correct mistakes. Chalo, introduce yourself!'
      : def.id === 'gym-coach'
        ? 'COACH HU MAIN! Aaj kya ukhada? Report your workout or ask for today’s target. NO EXCUSES!'
        : def.id === 'study-buddy'
          ? 'Study buddy ready! Kaunsa topic revise karna hai? Bol, quiz shuru karte hain!'
          : `${def.name} mode on. ${def.tagline}. Let's begin — ${def.id === 'upsc-interviewer' ? 'tell me your optional subject and background.' : def.id === 'interview-coach' ? 'which role and company?' : 'what are we working on?'}`;
    return {
      messages: [{ text: hello, meta: `${def.name} · per-mode memory on · “exit mode” to leave` }],
      speak: hello,
      card: { kind: 'persona', id: def.id, name: def.name, tagline: def.tagline },
    };
  }
  if (persona) {
    return personaTurn(text, persona.id);
  }

  // 7. Story mode.
  const sIntent = detectStoryIntent(text);
  const storySes = useFeaturesStore.getState().story;
  if (sIntent?.action === 'exit') {
    if (!storySes) return null;
    f.setStory(null);
    const msg = 'Kahani band. Meethe sapne! Shubh ratri!';
    return { messages: [{ text: msg }], speak: msg, card: null };
  }
  if (sIntent && (sIntent.action === 'enter' || sIntent.action === 'continue' || sIntent.action === 'new')) {
    return storyTurn(text, sIntent.action);
  }
  if (storySes) {
    // Any other utterance while in story mode = the child speaking to the story.
    if (/^(haan|han|yes|ok|acha|aur|aage)$/i.test(text.trim())) return storyTurn('', 'continue');
    return storyTurn(text, 'continue', text);
  }

  // 8. Night dump + morning digest.
  if (/^(morning digest|raat ka digest|night digest|subah ka digest)/i.test(text.trim())) {
    const { start, end } = lastNightWindow();
    const notes = f.nightNotes.filter((n) => n.at >= start && n.at <= end);
    const digest = compileMorningDigest(notes);
    return {
      messages: [{ text: digest.spoken, meta: 'Morning digest · from your night notes' }],
      speak: digest.spoken,
      card: { kind: 'digest', digest },
    };
  }
  if (detectNightIntent(text) || (isNightHour() && /(neend nahi|sapna aaya|soch raha|soch rahi|tension hai|mann (bhari|udaas))/.test(text.toLowerCase()) && text.length > 12)) {
    const clean = text.replace(/^(night note|raat note|sapna)[:\s]*/i, '').trim() || text;
    const tags = classifyNightNote(clean);
    const note = f.addNightNote(clean.slice(0, 500), tags);
    const count = f.nightNotes.length + 1;
    const msg = 'Saved. 🌙 So jao — subah is par baat karenge.';
    return {
      messages: [{ text: `Night note saved (${tags.join(', ')}). Subah digest mein milega.`, meta: 'Night capture · no questions at night, clarity in the morning' }],
      speak: msg,
      card: { kind: 'night', note, count },
    };
  }

  // 9. Research.
  const rq = detectResearchIntent(text);
  if (rq) {
    return researchTurn(rq);
  }
  if (/^(save brief|brief save karo|research save)/i.test(text.trim()) && lastBriefQuery && f.card?.kind === 'research') {
    try {
      const brief = f.card.brief;
      await useWorkspaceStore.getState().capture([{
        kind: 'note',
        title: `Research: ${brief.query}`.slice(0, 120),
        body: `${brief.spoken}\n\n${brief.picks.map((p) => `- ${p.name}: ${p.detail}`).join('\n')}\n\nSources:\n${brief.sources.map((s) => `- ${s.title}: ${s.url}`).join('\n')}\n(as of ${brief.asOf}${brief.grounded ? '' : '; UNVERIFIED — recheck online'})`,
      }], 'voice');
      const msg = 'Research saved to your memory. Find it in the list below.';
      return { messages: [{ text: msg }], speak: msg };
    } catch {
      const msg = 'Could not save — the workspace is still loading. Try again in a moment.';
      return { messages: [{ text: msg }], speak: msg };
    }
  }

  // 10. Time-travel recall.
  const rIntent = detectRecallIntent(text);
  if (rIntent) {
    return recallTurn(text, rIntent);
  }

  // 11. Briefs / close / forgetting / followups / money.
  const bIntent = detectBriefIntent(text);
  if (bIntent === 'morning') {
    const result = compileMorningBrief(briefData());
    return { messages: [{ text: result.spoken, meta: 'Morning brief · reminders, tasks, promises, money, body' }], speak: result.spoken, card: { kind: 'brief', title: 'Morning brief', result } };
  }
  if (bIntent === 'close') {
    const result = compileCloseDay(briefData());
    return { messages: [{ text: result.spoken, meta: 'Close my day · finished, rollover, tomorrow’s top 3' }], speak: result.spoken, card: { kind: 'brief', title: 'Close my day', result } };
  }
  if (bIntent === 'forgetting') {
    const result = forgettingScan(briefData());
    return { messages: [{ text: result.spoken, meta: 'Forgetting scan · overdue, promises, money, reminders' }], speak: result.spoken, card: { kind: 'forgetting', result } };
  }
  if (bIntent === 'followups') {
    const result = followupRadar(f.commitments);
    return { messages: [{ text: result.spoken, meta: 'Follow-up radar · your promises, tracked' }], speak: result.spoken, card: { kind: 'followups', result } };
  }
  if (bIntent === 'money') {
    const dues = briefData().moneyDue;
    if (!dues.length) {
      const msg = 'No bills or dues I can see. Add one with “remind me to pay…” or save a bill note, and I’ll guard it.';
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'money', dues } };
    }
    const msg = `${dues.length} payment${dues.length === 1 ? '' : 's'} on my radar. Top one: ${dues[0].title} — ${dues[0].detail}. Full list on screen.`;
    return { messages: [{ text: msg, meta: 'Money guard · from reminders + saved bills' }], speak: msg, card: { kind: 'money', dues } };
  }
  if (/^(done|mark done|ho gaya)[:\s]+(.+)/i.test(text.trim())) {
    const target = text.trim().match(/^(done|mark done|ho gaya)[:\s]+(.+)/i)?.[2] || '';
    const hit = f.commitments.find((c) => !c.done && c.text.toLowerCase().includes(target.toLowerCase().slice(0, 20)));
    if (hit) {
      f.doneCommitment(hit.id, true);
      const msg = `Marked done: ${hit.text}. Shabaash — word kept!`;
      return { messages: [{ text: msg }], speak: msg };
    }
  }

  // 12. Scribe.
  const scribePrefix = text.match(/^(scribe|minutes|meeting notes)[:\s]+([\s\S]{10,})/i);
  if (scribePrefix) {
    return scribeTurn(scribePrefix[2]);
  }
  if (/^scribe (mode|on|start|shuru)/i.test(text.trim())) {
    scribeBuffer = [];
    const msg = 'Scribe listening. Bolo — meeting, lecture, jo bhi. Khatam ho to bolo “scribe done”.';
    return { messages: [{ text: msg, meta: 'Scribe · collecting sentences' }], speak: msg, card: { kind: 'message', title: 'Scribe listening…', body: 'Speak your meeting. Say “scribe done” to get minutes.' } };
  }
  if (/^scribe (done|finish|khatam|band)/i.test(text.trim())) {
    if (!scribeBuffer) return null;
    const joined = scribeBuffer.join(' ');
    scribeBuffer = null;
    if (joined.trim().length < 10) {
      const msg = 'Scribe heard almost nothing. Try “scribe mode” again with short clear sentences.';
      return { messages: [{ text: msg }], speak: msg, card: null };
    }
    return scribeTurn(joined);
  }
  if (/^scribe (cancel|discard)/i.test(text.trim())) {
    scribeBuffer = null;
    return { messages: [{ text: 'Scribe discarded.' }], speak: 'Discarded.', card: null };
  }
  if (scribeBuffer !== null) {
    scribeBuffer.push(text);
    if (scribeBuffer.length > 40) scribeBuffer = scribeBuffer.slice(-40);
    return {
      messages: [],
      speak: '',
      card: { kind: 'message', title: `Scribe listening… (${scribeBuffer.length} lines)`, body: 'Say “scribe done” for minutes.' },
    };
  }
  if (/^save scribe tasks$/i.test(text.trim()) && f.card?.kind === 'scribe') {
    const tasks = f.card.tasks;
    if (!tasks.length) {
      const msg = 'No task-like lines in these minutes — nothing to save.';
      return { messages: [{ text: msg }], speak: msg };
    }
    try {
      await useWorkspaceStore.getState().capture(tasks.slice(0, 10).map((t) => ({ kind: 'task' as const, title: t.slice(0, 120), body: `From scribe minutes: ${t}` })), 'voice');
      const msg = `${Math.min(tasks.length, 10)} tasks saved from the minutes.`;
      return { messages: [{ text: msg }], speak: msg };
    } catch {
      const msg = 'Could not save — workspace still loading.';
      return { messages: [{ text: msg }], speak: msg };
    }
  }
  if (detectScribeIntent(text)) {
    const msg = 'Scribe ready. Type or speak after “scribe:”, or say “scribe mode” and I’ll collect the whole meeting.';
    return { messages: [{ text: msg }], speak: msg };
  }

  // 13. Recovery / energy advice.
  if (/(recovery|aaj (workout karu|gym jau|rest karu)|push or rest|train today)/i.test(text)) {
    const d = briefData();
    const line = recoveryLine({ sleepHrs: d.fitness.sleepHrs, energy: d.fitness.energy, workoutsLast3Days: d.fitness.workoutsLast3Days });
    return { messages: [{ text: `${line} (General guidance from YOUR logs — not medical advice.)`, meta: 'Recovery whisperer' }], speak: line };
  }

  // 14. Plan / upgrade. The plan is decided by the server when you are signed
  // in; saying a key here redeems it on your account instead of this browser.
  if (/^(my plan|upgrade|pro (plan|features)|pricing|plan dikhao|payment)/i.test(text.trim())) {
    const where =
      f.planSource === 'server'
        ? f.planVerified
          ? 'confirmed by your account'
          : 'cached from your account, not re-confirmed yet'
        : f.planSource === 'device-beta'
          ? 'unlocked in this browser only'
          : 'the free plan';
    const used = `Research ${f.usage.researchCount} of ${FREE_LIMITS.researchPerDay} today`;
    const msg = `You are on ${f.plan.toUpperCase()} (${where}). ${f.plan === 'free' ? 'Say “unlock” plus a key from the operator, or open Your space → Plan.' : `${used} so far.`}`;
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'info' } };
  }
  const unlockM = text.match(/unlock\s+([A-Za-z0-9-]+)/i);
  if (unlockM) {
    const rawKey = unlockM[1];
    const signedIn = !!useAssistantStore.getState().isAuthenticated;
    if (signedIn) {
      const { redeemKeyOnServer } = await import('./entitlements');
      const result = await redeemKeyOnServer(rawKey);
      if (!result.ok) {
        const msg = `The server refused that key: ${result.error}`;
        return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'invalid-key' } };
      }
      f.applyServerEntitlement(result.entitlement);
      const msg = `${result.entitlement.plan.toUpperCase()} redeemed on your account. It now applies on every device you sign in on.`;
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'unlocked' } };
    }
    const { validateBetaKey } = await import('./plans');
    const plan = validateBetaKey(rawKey);
    if (!plan) {
      const msg = 'That key did not validate. Check the code — format OB-PRO-XXXXXX — or sign in and redeem it on your account.';
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'invalid-key' } };
    }
    f.unlock(plan, rawKey.toUpperCase());
    const msg = `${plan === 'family' ? 'Family' : 'Pro'} unlocked in this browser only. Sign in with Google and say the same key again to attach it to your account.`;
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'unlocked' } };
  }

  return null;
}

// ---------- helpers ----------

/**
 * Ask the server to count one use of a persistent quota (research, email,
 * scribe, story) before doing the expensive work.
 *
 * Returns null when the use is allowed, when the user is signed out, or when
 * the server could not answer — in that last case the local count stands and
 * no server decision is claimed. Translator minutes stay device-counted: a
 * session is a device-local concept, and the server ledger counts the four
 * quotas that outlive a session.
 */
async function serverQuotaRefusal(
  feature: 'research' | 'email' | 'scribe' | 'story',
  units = 1,
): Promise<string | null> {
  try {
    if (!useAssistantStore.getState().isAuthenticated) return null;
    const { consumeOnServer } = await import('./entitlements');
    const result = await consumeOnServer(feature, units);
    if (!result.serverAnswered || result.allowed) return null;
    return result.message || `Your account allowance for ${feature} is reached. Nothing was charged.`;
  } catch {
    return null;
  }
}

async function finishEmail(slots: EmailSlots): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const tk = monthKey();
  if (f.plan === 'free' && f.usage.emailMonth === tk && f.usage.emailCount >= FREE_LIMITS.emailDraftsPerMonth) {
    f.setEmailSession(null);
    const msg = quotaMessage('email', f.plan);
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'email-quota' } };
  }
  const emailRefusal = await serverQuotaRefusal('email');
  if (emailRefusal) {
    f.setEmailSession(null);
    return { messages: [{ text: emailRefusal }], speak: emailRefusal, card: { kind: 'plan', reason: 'email-quota' } };
  }
  f.trackUse({ emailMonth: tk, emailCount: f.usage.emailMonth === tk ? f.usage.emailCount + 1 : 1 });
  f.setEmailSession(null);
  const name = useAssistantStore.getState().user?.displayName || 'Your Name';
  const draft = buildDraft(slots, name);
  return {
    messages: [{ text: draftSpokenSummary(draft), meta: 'Email draft · review, retone, copy or open mail app' }],
    speak: draftSpokenSummary(draft),
    card: { kind: 'email', slots, draft, userName: name },
  };
}

async function saveFitnessLog(
  log: Omit<FitnessLog, 'id' | 'createdAt' | 'source'>,
  source: FitnessLog['source'],
): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const saved = f.logFitness(log, source);
  const tk = dayKey(saved.createdAt);
  const totals = dayTotals(f.fitnessLogs.concat([saved]), tk);
  const streaks = computeStreaks(f.fitnessLogs.concat([saved]));
  const totalsLine = `${totals.workoutCount} workout${totals.workoutCount === 1 ? '' : 's'} · ${totals.foodCalories} kcal ≈ · ₹${totals.spend} spent today`;
  const streakLine = `🔥 ${streaks.logDays}-day log streak · 💪 ${streaks.workoutDays}-day workout streak`;
  const confirm = spokenConfirm(log);
  return {
    messages: [{ text: `${confirm} (${totalsLine}. ${streakLine}.)`, meta: 'Fitness timeline · tap to edit in Your space → Fitness' }],
    speak: `${confirm} ${streaks.logDays >= 3 ? `Day ${streaks.logDays} of your streak!` : ''}`,
    card: { kind: 'fitness', log: saved, totalsLine, streakLine },
  };
}

const FITNESS_RANGE_WORDS =
  /(expense|expenses|kharch|kharcha|kharche|spend|spent|spending|payment|food|khana|meal|diet|calorie|workout|exercise|kasrat|sleep|neend|water|paani|weight|vazan|health|fitness)/i;
const FITNESS_RANGE_DATES =
  /(yesterday|today|kal\b|aaj|parso|day before yesterday|this week|last week|hafte|hafta|this month|last month|mahina)/i;
const FITNESS_RANGE_QUESTIONS =
  /(what|how much|kitna|kitne|kya|kab|when|show|batao|dikhao|total|hisab|hisaab|summary|report|yaad|savings|bache)/i;

/** Is this a QUESTION about logged fitness/food/expense data (vs a new log)?
 *  Needs a fitness word plus either a date word ("yesterday expenses") or a
 *  question word ("how much did I spend"). Plain logs ("kharcha 200 chai",
 *  "I spent 200 on chai") have neither and fall through to the logger. */
export function detectFitnessRangeQuery(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!FITNESS_RANGE_WORDS.test(t)) return false;
  if (FITNESS_RANGE_DATES.test(t)) return true;
  return FITNESS_RANGE_QUESTIONS.test(t);
}

/** Deterministic answer from the device log for a date range. No AI, no
 *  guessing, works fully offline. Empty ranges say so honestly and teach
 *  the exact logging phrase. */
async function fitnessRangeTurn(text: string): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const range = parseDateRef(text, now, true) || {
    start: dayStart.getTime(),
    end: dayStart.getTime() + 86400000,
    label: 'today',
    key: dayKey(dayStart.getTime()),
  };
  const inRange = f.fitnessLogs.filter(
    (l) => l.createdAt >= range.start && l.createdAt < range.end,
  );
  const expenses = inRange.filter((l) => l.kind === 'expense');
  const food = inRange.filter((l) => l.kind === 'food');
  const workouts = inRange.filter((l) => l.kind === 'workout');
  const spend = expenses.reduce((s, l) => s + (l.amount ?? l.qty ?? 0), 0);
  const kcal = food.reduce((s, l) => s + (l.calories ?? 0), 0);

  const wantsSpend = /(expense|kharch|kharche|spend|spent|spending|payment)/i.test(text);
  const wantsFood = /(food|khana|meal|diet|calorie)/i.test(text) && !wantsSpend;

  if (!inRange.length) {
    const msg = `No ${wantsSpend ? 'expenses' : wantsFood ? 'food' : 'fitness entries'} logged ${range.label === 'today' ? 'today' : `for ${range.label}`} yet. Say “kharcha 200 chai” to log spending, or “2 roti khayi” for food.`;
    return {
      messages: [{ text: msg, meta: `Log check · ${range.label} · full timeline in Your space → Fitness` }],
      speak: msg,
      card: { kind: 'message', title: `Nothing logged · ${range.label}`, body: msg },
    };
  }

  const lines: string[] = [];
  if (expenses.length) {
    lines.push(`💸 Spending: ₹${spend} across ${expenses.length} item${expenses.length === 1 ? '' : 's'}`);
    for (const l of expenses.slice(0, 10)) lines.push(`• ${formatLogLine(l)}`);
    if (expenses.length > 10) lines.push(`• …and ${expenses.length - 10} more (see Fitness panel)`);
  }
  if (food.length) {
    lines.push(`🍛 Food: ${food.length} item${food.length === 1 ? '' : 's'}${kcal ? `, ≈${kcal} kcal` : ''}`);
    for (const l of food.slice(0, 8)) lines.push(`• ${formatLogLine(l)}`);
  }
  if (workouts.length && !wantsSpend && !wantsFood) {
    lines.push(`💪 Workouts: ${workouts.length} (${workouts.map((w) => w.label).join('; ')})`);
  }
  const when = range.label === 'today' ? 'Aaj' : `${range.label} mein`;
  const speak = wantsSpend || (!wantsFood && expenses.length)
    ? `${when} ₹${spend} kharcha, ${expenses.length} cheezon par.${food.length ? ` Khana: ${food.length} items.` : ''}`
    : wantsFood
      ? `${when} ${food.length} cheezein khayi${kcal ? `, lagbhag ${kcal} calories` : ''}.`
      : `${when}: ${workouts.length} workouts, ${food.length} food items, ₹${spend} kharcha.`;
  const body = `${lines.join('\n')}`;
  return {
    messages: [{ text: body, meta: `Log check · ${range.label} · full timeline in Your space → Fitness` }],
    speak,
    card: { kind: 'message', title: `Logged · ${range.label}`, body },
  };
}

async function fitnessSummary(): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const tk = dayKey(Date.now());
  const totals = dayTotals(f.fitnessLogs, tk);
  const streaks = computeStreaks(f.fitnessLogs);
  const rec = recoveryLine({
    sleepHrs: totals.sleepHrs,
    energy: totals.energy,
    workoutsLast3Days: f.fitnessLogs.filter((l) => l.kind === 'workout' && l.createdAt >= Date.now() - 3 * 86400000).length,
  });
  const body = `Today: ${totals.workoutCount} workouts (${totals.workouts.join('; ') || 'none yet'}) · ${totals.foodCalories} kcal ≈ from ${totals.foodItems} items · ₹${totals.spend} spent${totals.sleepHrs ? ` · slept ${totals.sleepHrs}h` : ''}. Streaks: ${streaks.logDays} days logging, ${streaks.workoutDays} days training. ${rec}`;
  return {
    messages: [{ text: body, meta: 'Fitness summary · full timeline in Your space → Fitness' }],
    speak: `Aaj: ${totals.workoutCount} workouts, lagbhag ${totals.foodCalories} calories, ₹${totals.spend} kharcha. ${streaks.logDays} din ki streak! ${rec}`,
    card: { kind: 'message', title: 'Fitness summary', body },
  };
}

async function translateTurn(text: string, ses: { pairId: string; startedAt: number; turns: number }): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const pair = pairById(ses.pairId);
  const elapsedMin = (Date.now() - ses.startedAt) / 60000;
  if (f.plan === 'free' && elapsedMin >= FREE_LIMITS.translateMinsPerSession) {
    f.setTranslator(null);
    const msg = quotaMessage('translate', f.plan);
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'translate-quota' } };
  }
  const detected = detectLang(text);
  const from = detected === pair.a || detected === pair.b ? detected : pair.a;
  const to = from === pair.a ? pair.b : pair.a;
  let out = offlineTranslate(text, from, to);
  let live = false;
  if (!out) {
    const ans = await askBrain(translationPrompt(text, from, to), [], useAssistantStore.getState().apiKey, {
      systemOverride: TRANSLATE_SYSTEM,
      priority: priority(),
    });
    live = isLiveAnswer(ans);
    out = live ? ans.replace(/^["“]|["”]$/g, '').trim().slice(0, 500) : null;
  }
  if (!out) {
    const msg = 'Translation needs internet right now, and this line is not in my offline phrasebook. Try a short common line, or reconnect.';
    return { messages: [{ text: msg }], speak: msg };
  }
  f.setTranslator({ ...useFeaturesStore.getState().translator!, turns: ses.turns + 1, lastFrom: text.slice(0, 200), lastTo: out, fromLang: LANG_NAMES[from], toLang: LANG_NAMES[to] });
  return {
    messages: [{ text: `${LANG_NAMES[from]}: “${text}”\n${LANG_NAMES[to]}: “${out}”`, meta: live ? 'Live translation' : 'Offline phrasebook' }],
    speak: out,
    card: { kind: 'translator', pairId: pair.id, lastFrom: text.slice(0, 200), lastTo: out, fromLang: LANG_NAMES[from], toLang: LANG_NAMES[to] },
  };
}

async function personaTurn(text: string, personaId: string): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const def = personaById(personaId);
  if (!def) {
    f.setPersona(null);
    return { messages: [{ text: 'That mode ended.' }], speak: 'Mode band.' };
  }
  const notes = f.personaNotes[personaId] || [];
  // Offline-first for tutor + coach.
  if (personaId === 'english-tutor') {
    const corrections = offlineTutorCorrections(text);
    if (corrections.length) {
      const note = extractModeNote(personaId, text, corrections);
      if (note) f.addPersonaNote(personaId, note);
      const body = `${formatCorrections(corrections)}\n\nGood try — say one more sentence! (Offline corrections)`;
      return {
        messages: [{ text: body, meta: `${def.name} · offline corrections` }],
        speak: `Almost! ${corrections[0].right}. ${corrections[0].why} Say it once more!`,
        card: { kind: 'persona', id: def.id, name: def.name, tagline: def.tagline, corrections: formatCorrections(corrections) },
      };
    }
  }
  if (personaId === 'gym-coach') {
    const tip = offlineCoachReply(text);
    if (tip) {
      const note = extractModeNote(personaId, text, []);
      if (note) f.addPersonaNote(personaId, note);
      return {
        messages: [{ text: `${tip} (Offline coaching)`, meta: def.name }],
        speak: tip,
        card: { kind: 'persona', id: def.id, name: def.name, tagline: def.tagline },
      };
    }
  }
  const history = useAssistantStore.getState().messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
  const answer = await askBrain(`${text}`, history, useAssistantStore.getState().apiKey, {
    systemOverride: personaPrompt(def, notes),
    priority: priority(),
  });
  if (!isLiveAnswer(answer)) {
    if (personaId === 'english-tutor') {
      const msg = 'No mistakes I can spot offline — and my AI brain is unreachable. Try a longer sentence, or reconnect for full tutoring!';
      return { messages: [{ text: msg }], speak: msg };
    }
    const msg = 'My AI brain is unreachable right now. Coach rule meanwhile: 20 pushups, report back. Dismissed!';
    return { messages: [{ text: msg }], speak: msg };
  }
  f.setPersona({ ...(f.persona!), turns: (f.persona?.turns || 0) + 1 });
  return {
    messages: [{ text: answer, meta: `${def.name} · “exit mode” to leave` }],
    speak: answer,
    card: { kind: 'persona', id: def.id, name: def.name, tagline: def.tagline },
  };
}

function storyAgeFrom(text: string): AgeBand | null {
  const m = text.match(/(\d{1,2})\s*(year|saal)/i);
  if (!m) return null;
  const age = Number(m[1]);
  if (age <= 6) return '3-6';
  if (age <= 10) return '7-10';
  return '11+';
}

async function storyTurn(text: string, action: 'enter' | 'continue' | 'new', kidSaid?: string): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const lang = useAssistantStore.getState().settings.language;
  const storyLang = lang === 'marathi' ? 'marathi' : lang === 'hi-IN' ? 'hindi' : lang.startsWith('en') ? 'english' : 'hinglish';
  let thread: StoryThread | undefined;
  if (action === 'new' || !f.stories.length) {
    const age: AgeBand = storyAgeFrom(text) || '7-10';
    thread = {
      id: `story-${Date.now()}`,
      title: action === 'new' && text ? titleFromLine(text) : 'Jungle Doston ki Kahani',
      ageBand: age,
      language: storyLang as StoryThread['language'],
      characters: [],
      threads: [],
      episodes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } else {
    const ses = useFeaturesStore.getState().story;
    thread = f.stories.find((s) => s.id === ses?.threadId) || f.stories[0];
  }
  if (!thread) {
    const msg = 'Kahani shuru nahi ho payi. Dobara bolo “kahani sunao”.';
    return { messages: [{ text: msg }], speak: msg };
  }
  // Trial + bedtime gates.
  if (!planAllows(f.plan, 'story-full')) {
    if (f.usage.storyTrial >= TRIAL_EPISODES) {
      const msg = quotaMessage('story', f.plan);
      return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'story-trial' } };
    }
    const storyRefusal = await serverQuotaRefusal('story');
    if (storyRefusal) {
      return { messages: [{ text: storyRefusal }], speak: storyRefusal, card: { kind: 'plan', reason: 'story-trial' } };
    }
  }
  const cap = useFeaturesStore.getState().storyCap || BEDTIME_CAP;
  if (episodesToday(thread) >= cap && action === 'continue') {
    const msg = 'Bas aaj ke liye itna! Kahani kal aage badhegi. Meethe sapne — shubh ratri!';
    return { messages: [{ text: msg, meta: `Bedtime cap · ${cap} episodes/day (parents can change it)` }], speak: msg };
  }
  const intro = storySpokenIntro(thread, thread.episodes.length === 0);
  const prompt = episodePrompt(thread, kidSaid);
  const answer = await askBrain(prompt, [], useAssistantStore.getState().apiKey, {
    systemOverride: 'You are a beloved children’s storyteller. Follow the user’s story instructions exactly, including the CAST/THREADS line.',
    priority: priority(),
  });
  let episode: string;
  let offline = false;
  let chars = thread.characters;
  let threads = thread.threads;
  if (isLiveAnswer(answer)) {
    const parsed = parseStoryState(answer);
    episode = parsed.clean.slice(0, 1500) || answer.slice(0, 1500);
    if (parsed.characters.length) chars = [...new Set([...chars, ...parsed.characters])].slice(0, 8);
    if (parsed.threads.length) threads = [...new Set([...threads, ...parsed.threads])].slice(0, 8);
  } else {
    episode = offlineEpisode(thread);
    offline = true;
  }
  const next: StoryThread = {
    ...thread,
    characters: chars,
    threads,
    episodes: [...thread.episodes, { text: episode, at: Date.now(), offline }].slice(-100),
    updatedAt: Date.now(),
  };
  f.saveStory(next);
  f.setStory({ threadId: next.id, startedAt: Date.now() });
  if (!planAllows(useFeaturesStore.getState().plan, 'story-full')) {
    f.trackUse({ storyTrial: f.usage.storyTrial + 1 });
  }
  return {
    messages: [{ text: `${intro}\n\n${episode}`, meta: `${next.title} · episode ${next.episodes.length}${offline ? ' · told offline' : ''} · “aage sunao” for more` }],
    speak: `${intro} ${episode}`,
    card: { kind: 'story', thread: next, episode, offline },
  };
}

async function researchTurn(query: string): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const tk = todayKey();
  const deep = planAllows(f.plan, 'research-deep');
  if (!deep && f.usage.researchDay === tk && f.usage.researchCount >= FREE_LIMITS.researchPerDay) {
    const msg = quotaMessage('research', f.plan);
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'research-quota' } };
  }
  const researchRefusal = await serverQuotaRefusal('research');
  if (researchRefusal) {
    return { messages: [{ text: researchRefusal }], speak: researchRefusal, card: { kind: 'plan', reason: 'research-quota' } };
  }
  lastBriefQuery = query;
  const entities = planEntitySearches(query).slice(0, deep ? 3 : 2);
  const sources: ResearchSource[] = [];
  for (const e of entities) {
    try {
      const w = await fetchWikipedia(e);
      if (w?.text) sources.push({ title: w.title, url: w.url, snippet: w.text.slice(0, 600) });
    } catch { /* next entity */ }
  }
  if (!sources.length) {
    const brief = ungroundedBrief(query);
    return {
      messages: [{ text: `${brief.spoken}\n\nChecklist:\n- ${brief.bullets.join('\n- ')}`, meta: `Research · ${query} · no live sources (honest mode)` }],
      speak: brief.spoken,
      card: { kind: 'research', brief },
    };
  }
  f.trackUse({ researchDay: tk, researchCount: f.usage.researchDay === tk ? f.usage.researchCount + 1 : 1 });
  const synthInput = `QUERY: ${query}\nSOURCES:\n${sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url}): ${s.snippet}`).join('\n')}`;
  const answer = await askBrain(synthInput, [], useAssistantStore.getState().apiKey, {
    systemOverride: RESEARCH_SYSTEM,
    priority: priority(),
  });
  if (!isLiveAnswer(answer)) {
    const brief = ungroundedBrief(query);
    brief.sources = sources;
    brief.spoken = `Sources mil gaye (${sources.map((s) => s.title).join(', ')}) lekin AI summary net ke bina nahi ban paya. Links screen par hain — khud padh lo, ya net par “${query}” dobara poochho.`;
    return {
      messages: [{ text: brief.spoken, meta: 'Research · sources only, offline' }],
      speak: brief.spoken,
      card: { kind: 'research', brief },
    };
  }
  const brief = parseSynthesis(query, answer, sources, new Date().toISOString().slice(0, 10));
  const body = `${brief.spoken}\n\n${brief.picks.map((p) => `• ${p.name} — ${p.detail}`).join('\n')}\n\nSources: ${sources.map((s) => s.title).join(', ')} (as of ${brief.asOf}). Say “save brief” to keep it.`;
  return {
    messages: [{ text: body, meta: `Research · grounded in ${sources.length} source${sources.length === 1 ? '' : 's'}` }],
    speak: brief.spoken,
    card: { kind: 'research', brief },
  };
}

async function recallTurn(text: string, intent: 'day' | 'week' | 'month' | 'when' | 'lastAsked' | 'decisions'): Promise<FeatureTurn> {
  const a = useAssistantStore.getState();
  const w = useWorkspaceStore.getState();
  const now = new Date();
  if (intent === 'lastAsked') {
    const users = a.messages.filter((m) => m.role === 'user');
    const last = users[users.length - 1];
    if (!last) {
      const msg = 'You have not asked anything yet in this conversation.';
      return { messages: [{ text: msg }], speak: msg };
    }
    const idx = a.messages.findIndex((m) => m.id === last.id);
    const reply = a.messages.slice(idx + 1).find((m) => m.role === 'assistant');
    const body = `You asked: “${last.content}” (${formatCitation(last.createdAt)}).${reply ? `\nI answered: “${reply.content.slice(0, 200)}”` : ''}`;
    return { messages: [{ text: body, meta: 'Time-travel · your own words, quoted' }], speak: `You asked: ${last.content}. ${reply ? `And I said: ${reply.content.slice(0, 150)}` : ''}` };
  }
  if (intent === 'decisions') {
    const { rows } = depthGate(w.items);
    const list = rows.filter((i) => i.kind === 'decision').slice(0, 5);
    if (!list.length) {
      const msg = 'No decisions recorded yet. Say “decision: …” or “we decided …” and I’ll keep them forever.';
      return { messages: [{ text: msg }], speak: msg };
    }
    const body = `Your recorded decisions:\n${list.map((d) => `• ${d.title} (${formatCitation(d.createdAt)})`).join('\n')}`;
    return { messages: [{ text: body, meta: 'Time-travel · decisions' }], speak: `You recorded ${list.length} decisions. Latest: ${list[0].title}.` };
  }
  let range = parseDateRef(text, now, true);
  if (!range) {
    if (intent === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      range = { start: d.getTime(), end: now.getTime(), label: 'the last 7 days', key: 'week' };
    } else if (intent === 'month') {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      range = { start: d.getTime(), end: now.getTime(), label: 'the last 30 days', key: 'month' };
    } else {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const s = new Date(y.getFullYear(), y.getMonth(), y.getDate());
      range = { start: s.getTime(), end: s.getTime() + 86400000, label: 'yesterday', key: todayKey(y) };
    }
  }
  const msgs = depthGate(a.messages.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })));
  const items = depthGate(w.items.map((i) => ({ kind: i.kind, title: i.title, body: i.body, status: i.status, createdAt: i.createdAt, updatedAt: i.updatedAt })));
  const summary = summarizeRange(msgs.rows, items.rows, range);
  const gatedNote = msgs.gated ? ' (Free recall covers 30 days — Pro unlocks all time.)' : '';
  return {
    messages: [{ text: `${summary.spoken}${summary.empty ? '' : `\n\n${summary.bullets.join('\n')}`}${gatedNote}`, meta: `Time-travel · ${range.label}` }],
    speak: summary.spoken,
    card: { kind: 'recall', range, summary },
  };
}

async function scribeTurn(text: string): Promise<FeatureTurn> {
  const f = useFeaturesStore.getState();
  const tk = todayKey();
  if (f.plan === 'free' && f.usage.scribeDay === tk && f.usage.scribeCount >= FREE_LIMITS.scribePerDay) {
    const msg = quotaMessage('scribe', f.plan);
    return { messages: [{ text: msg }], speak: msg, card: { kind: 'plan', reason: 'scribe-quota' } };
  }
  const scribeRefusal = await serverQuotaRefusal('scribe');
  if (scribeRefusal) {
    return { messages: [{ text: scribeRefusal }], speak: scribeRefusal, card: { kind: 'plan', reason: 'scribe-quota' } };
  }
  f.trackUse({ scribeDay: tk, scribeCount: f.usage.scribeDay === tk ? f.usage.scribeCount + 1 : 1 });
  const minutes = extractMinutes(text);
  const tasks = minutesToTasks(minutes);
  const body = `${minutes.summary}\n\nDecisions:\n${minutes.decisions.map((d) => `• ${d}`).join('\n') || '• none'}\n\nOwners:\n${minutes.owners.map((o) => `• ${o.who} — ${o.what}`).join('\n') || '• none'}\n\nDeadlines:\n${minutes.deadlines.map((d) => `• ${d.what} (${d.when})`).join('\n') || '• none'}\n\nOpen questions:\n${minutes.questions.map((q) => `• ${q}`).join('\n') || '• none'}`;
  return {
    messages: [{ text: body, meta: 'Scribe minutes · works offline · “save scribe tasks” to create tasks' }],
    speak: spokenMinutes(minutes),
    card: { kind: 'scribe', minutes, tasks },
  };
}
