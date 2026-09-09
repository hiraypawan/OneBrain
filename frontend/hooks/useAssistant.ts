'use client';
import { useCallback, useRef } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { askPuter } from '@/lib/puter';
import { buildSystem } from '@/lib/gemini';
import { looksFactual, fetchWikipedia } from '@/lib/knowledge';
import { cleanForSpeech, splitReply, ttsLangFor } from '@/lib/speech';
import { micConstraints, diagnoseMicError, countAudioInputs } from '@/lib/audio';
import { digestMessages } from '@/lib/digest';
import { buildProfileBlock } from '@/lib/profile';
import { recallRelevant, formatRecall } from '@/lib/recall';
import { extractiveSummary } from '@/lib/summarize';
import { fitHistory } from '@/lib/context';
import {
  requestNotificationPermission,
  showActiveNotification,
  dismissActiveNotification,
} from '@/services/notificationService';
import { detectPitch, median, rangeFromPitch, isDifferentSpeaker, shouldIgnoreTranscript } from '@/lib/voiceprint';
import { normalizeHinglish } from '@/lib/transliterate';
import { parseVoiceCommand, parseMediaCommand, type VoiceCommand } from '@/lib/commands';
import { MEDIA_PLAY_EVENT, MEDIA_CONTROL_EVENT } from '@/lib/media';
import { parseReminderIntent } from '@/lib/reminders';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export interface ChatExtra {
  profile?: string;
  recall?: string;
  verbosity?: string;
}

async function fetchChat(message: string, history: { role: string; content: string }[], userKey?: string, extra?: ChatExtra) {
  // 0a. Factual questions go to live Wikipedia first (fresh data, no quota):
  // current events, lists, capitals — no hedging about training cutoffs.
  try {
    if (looksFactual(message)) {
      const wiki = await fetchWikipedia(message);
      if (wiki?.text) return wiki.text;
    }
  } catch {}
  // 0b. Keyless browser AI (Puter) — zero setup, user's own fair-use quota.
  //    If the user added a Gemini key it is still tried next as the
  //    higher-quality backup; Puter winning first is fine for voice chat.
  try {
    const puterAnswer = await askPuter(history, buildSystem());
    if (puterAnswer) return puterAnswer;
  } catch {}
  // Prefer external backend, fall back to Next.js route, then local mock.
  // (Deduped: without a backend configured both entries are the same route.)
  const urls = Array.from(
    new Set([API_URL ? `${API_URL}/api/chat` : null, '/api/chat'].filter(Boolean) as string[])
  );
  for (const url of urls) {
    try {
      if (url.startsWith('http') && API_URL === '') continue;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message, history,
          userKey: userKey || undefined,
          profile: extra?.profile || undefined,
          recall: extra?.recall || undefined,
          verbosity: extra?.verbosity || undefined,
        }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j.answer) return j.answer as string;
      }
    } catch {}
  }
  return localBrain(message);
}

function localBrain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('train')) return 'Next train is 6:42 PM from platform 2. Leave by 6:15 to make it.';
  if (m.includes('weather')) return 'It is clear right now, 28 degrees. Good evening for a walk.';
  if (m.includes('remind')) return 'Done. I have saved your reminder. I will notify you on time.';
  if (m.includes('hello') || m.includes('namaste')) return 'Namaste! Main sun raha hoon. Boliye, kya help karoon?';
  return `Samajh gaya: "${message}". Main is par kaam kar raha hoon. (Offline smart reply — keyless AI unreachable right now.)`;
}

export function useAssistant() {
  const store = useAssistantStore();
  const streamRef = useRef<MediaStream | null>(null);
  const recogRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const wakeLockRef = useRef<any>(null);
  const retryRef = useRef(0);
  const speakingRef = useRef(false);
  const expectingRef = useRef(false); // true only while we genuinely want mic input
  const lastFinalRef = useRef<{ text: string; t: number }>({ text: '', t: 0 });
  // Breaks the callback cycle (transcript -> command -> start/stop -> transcript):
  // cross-calls go through this ref, filled in after all callbacks exist.
  const controlsRef = useRef<{
    stopActive: () => void;
    startActive: () => Promise<void>;
    speak: (t: string) => Promise<void>;
  }>({ stopActive: () => {}, startActive: async () => {}, speak: async () => {} });
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pitchWinRef = useRef<Array<{ t: number; hz: number }>>([]);
  const pitchTimerRef = useRef<any>(null);
  const speakerNoticeOnRef = useRef(false);

  const speak = useCallback(async (text: string) => {
    // Speak only the user's-language part, scrubbed of emojis/markdown.
    const { spoken } = splitReply(text);
    const clean = cleanForSpeech(spoken);
    if (!clean) return;
    store.setCurrentStatus('speaking');
    store.logBgEvent('tts-start', clean.slice(0, 50));
    // Pause listening while WE talk: the mic must not hear our own reply,
    // background songs, or YouTube playing during the answer.
    speakingRef.current = true;
    try { recogRef.current?.stop(); } catch {}
    try {
      // Try cloud TTS, fallback to browser speechSynthesis
      try {
        const r = await fetch('/api/speech/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, speed: store.settings.voiceSpeed }),
        });
        if (r.ok) {
          const blob = await r.blob();
          if (blob.size > 1000) {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            // Route cloud TTS to the chosen speaker (earbuds vs phone).
            // Browser-voice replies always use the OS default (platform rule).
            try {
              const sink = useAssistantStore.getState().speakerDeviceId;
              if (sink && typeof (audio as any).setSinkId === 'function') {
                await (audio as any).setSinkId(sink);
              }
            } catch {}
            await new Promise<void>((resolve) => {
              audio.onended = () => resolve();
              audio.onerror = () => resolve();
              audio.play().catch(() => resolve());
            });
            return;
          }
        }
      } catch {}
      // Fallback: Web Speech API (routes to earbuds automatically).
      // Voice locale follows the reply's script: Marathi answers in a
      // Marathi voice, English answers in English, and so on.
      await new Promise<void>((resolve) => {
        try {
          const u = new SpeechSynthesisUtterance(clean);
          u.rate = store.settings.voiceSpeed;
          u.lang = ttsLangFor(clean, store.settings.language);
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
          setTimeout(resolve, 30000);
        } catch {
          resolve();
        }
      });
    } finally {
      speakingRef.current = false;
      const st = useAssistantStore.getState();
      st.logBgEvent('tts-end');
      if (st.isActive) {
        expectingRef.current = true;
        try { recogRef.current?.start(); } catch {}
      }
    }
  }, [store]);

  // Median pitch of the last few seconds of mic audio -> who just spoke?
  // Tags the message (male/female voice) and flags voices far from the
  // enrolled owner, so 2-3 people talking don't get silently mixed up.
  const utteranceMeta = useCallback((): { meta?: string; hz: number | null } => {
    const hz = median(pitchWinRef.current.map((w) => w.hz).filter((h) => h > 0));
    pitchWinRef.current = [];
    if (hz == null) return { meta: undefined, hz: null };
    const st = useAssistantStore.getState();
    const range = rangeFromPitch(hz);
    const parts: string[] = [];
    if (range !== 'unknown') parts.push(range === 'male' ? 'male voice' : 'female voice');
    if (isDifferentSpeaker(st.voiceBaseline, hz)) {
      parts.push('different from enrolled voice');
      speakerNoticeOnRef.current = true;
      st.setMicNotice('Second voice heard — answering you. People nearby can mix in; enroll your voice in Settings.');
    } else if (speakerNoticeOnRef.current) {
      speakerNoticeOnRef.current = false;
      if (st.micNotice) st.setMicNotice(null);
    }
    return {
      meta: parts.length ? parts.join(' · ') + ` (~${Math.round(hz)} Hz)` : undefined,
      hz,
    };
  }, []);

  // Exact-phrase controls: stop / continue / new chat / repeat.
  // Runs locally — instant, works offline, never confuses the AI context.
  // Defined BEFORE handleTranscript (which calls it) and uses controlsRef
  // (not the callbacks directly) to avoid init-order and type cycles.
  const runVoiceCommand: (cmd: Exclude<VoiceCommand, null>) => Promise<void> = useCallback(
    async (cmd) => {
      const st = useAssistantStore.getState();
      const ctl = controlsRef.current;
      if (cmd === 'stop') {
        try {
          window.dispatchEvent(new CustomEvent(MEDIA_CONTROL_EVENT, { detail: 'close' }));
        } catch {}
        if (st.isActive) ctl.stopActive();
        return;
      }
      if (cmd === 'continue') {
        try {
          if (!st.isActive) {
            await ctl.startActive();
            return;
          }
        } catch {
          st.setMicNotice('Mic start nahi hua — Active button dabao.');
          return;
        }
        try {
          window.speechSynthesis?.cancel();
        } catch {}
        st.setCurrentStatus('listening');
        expectingRef.current = true;
        try {
          recogRef.current?.start();
        } catch {}
        return;
      }
      if (cmd === 'new') {
        st.newConversation();
        const msg = 'Nayi chat shuru ho gayi. Bolo, kya baat karein?';
        st.addMessage('assistant', msg);
        await ctl.speak(msg);
        if (useAssistantStore.getState().isActive) st.setCurrentStatus('listening');
        return;
      }
      if (cmd === 'notyou') {
        // "Wasn't talking to you": erase the last exchange everywhere and
        // confirm briefly — the hands-free undo for stray pickups.
        st.removeLastExchange();
        const msg = 'Okay, ignored.';
        st.addMessage('assistant', msg);
        await ctl.speak(msg);
        if (useAssistantStore.getState().isActive) st.setCurrentStatus('listening');
        return;
      }
      const last = [...st.messages].reverse().find((m) => m.role === 'assistant');
      if (last) {
        await ctl.speak(last.content);
        if (useAssistantStore.getState().isActive) st.setCurrentStatus('listening');
      } else {
        const msg = 'Abhi kuch dohraya nahi hai.';
        st.addMessage('assistant', msg);
        await ctl.speak(msg);
      }
    },
    []
  );

  const handleTranscript = useCallback(async (transcript: string, confidence?: number) => {
    if (!transcript.trim()) return;
    // Proof-of-hearing first: every accepted utterance is timestamped, so a
    // screen-off session can later prove what it heard and when.
    useAssistantStore.getState().logBgEvent('heard', transcript.slice(0, 60));
    // 1. Exact voice commands drive the session — never sent to the AI.
    //    (Commands always work, even for voices that would otherwise be gated.)
    const cmd = parseVoiceCommand(transcript);
    if (cmd) {
      await runVoiceCommand(cmd);
      return;
    }
    // 2. Who spoke? Strangers are filtered BEFORE any AI call, so a nearby
    //    call/TV never becomes an "answer" to the owner.
    const { meta, hz } = utteranceMeta();
    const stGate = useAssistantStore.getState();
    const verdict = shouldIgnoreTranscript({
      baselineHz: stGate.voiceBaseline,
      heardHz: hz,
      confidence,
      ownerOnly: !!stGate.settings.ownerOnly,
    });
    if (verdict !== 'answer') {
      stGate.addMessage('user', transcript, meta);
      if (verdict === 'drop-notice') {
        stGate.setMicNotice('Ignored — not your enrolled voice (strict mode ON). Turn it off in Settings to hear everyone.');
      }
      store.setCurrentStatus('listening');
      expectingRef.current = true;
      try {
        recogRef.current?.start();
      } catch {}
      return;
    }
    // 2. Conversational reminders: created + confirmed, no AI round-trip.
    const ri = parseReminderIntent(transcript);
    if (ri) {
      const st0 = useAssistantStore.getState();
      st0.addReminder({ id: `${Date.now()}`, title: ri.title, time: ri.time, date: ri.date, active: true });
      const confirm = `Done. Reminder set: ${ri.title}${ri.date ? ` on ${ri.date}` : ''} at ${ri.time}.`;
      store.addMessage('user', transcript);
      store.addMessage('assistant', confirm);
      await speak(confirm);
      if (store.isActive) store.setCurrentStatus('listening');
      return;
    }
    // 3. Media: "play kesariya" searches free sources and plays; pause /
    //    resume / stop-song control the player. Playback is delegated to
    //    <MediaPlayer/> (it owns search UI + audio); controls are instant here.
    const media = parseMediaCommand(transcript);
    if (media) {
      store.addMessage('user', transcript);
      if (media.action === 'play') {
        window.dispatchEvent(new CustomEvent(MEDIA_PLAY_EVENT, { detail: { query: media.query, kinds: media.kinds } }));
        return; // MediaPlayer speaks/shows the outcome.
      }
      window.dispatchEvent(new CustomEvent(MEDIA_CONTROL_EVENT, { detail: media.action }));
      const confirm = media.action === 'pause' ? 'Paused.' : media.action === 'resume' ? 'Playing.' : 'Closed.';
      store.addMessage('assistant', confirm);
      await speak(confirm);
      if (store.isActive) store.setCurrentStatus('listening');
      return;
    }
    store.setCurrentStatus('processing');
    store.addMessage('user', transcript, meta);
    const st = useAssistantStore.getState();
    const full = st.messages;
    // Memory-aware context: profile (who they are) + recall (relevant older
    // chats) + fitted recent history (never overflows small models).
    let profile = '';
    let recall = '';
    try {
      const d = digestMessages(
        full.slice(-200).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt }))
      );
      profile = buildProfileBlock({ digest: d, summary: st.sessionSummary, name: st.user?.displayName });
      recall = formatRecall(
        recallRelevant(
          transcript,
          full.slice(0, -6).map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
          3
        )
      );
    } catch {}
    const tail = full.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const history = fitHistory(tail);
    const answer = await fetchChat(transcript, history, st.apiKey, {
      profile, recall, verbosity: st.settings.verbosity,
    });
    store.addMessage('assistant', answer);
    // Rolling summary every 20 user messages: fold old context, keep it fresh.
    try {
      const after = useAssistantStore.getState();
      const userCount = after.messages.filter((m) => m.role === 'user').length;
      if (userCount > 0 && userCount % 20 === 0) {
        after.setSessionSummary(extractiveSummary(after.messages, after.sessionSummary || ''));
      }
    } catch {}
    await speak(answer);
    if (store.isActive) store.setCurrentStatus('listening');
  }, [store, speak, utteranceMeta, runVoiceCommand]);

  const stopPitchTracking = useCallback(() => {
    try { if (pitchTimerRef.current) clearInterval(pitchTimerRef.current); } catch {}
    pitchTimerRef.current = null;
    try { analyserRef.current?.disconnect(); } catch {}
    analyserRef.current = null;
    pitchWinRef.current = [];
  }, []);

  // Sample mic pitch a few times per second while listening. Feeds the
  // speaker tags above; cheap (one 2048 FFT buffer per tick).
  const startPitchTracking = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      const stream = streamRef.current;
      if (!ctx || !stream) return;
      stopPitchTracking();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
      pitchTimerRef.current = setInterval(() => {
        try {
          const st = useAssistantStore.getState();
          if (!st.isActive || st.currentStatus !== 'listening') return;
          const buf = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(buf);
          const hz = detectPitch(buf, ctx.sampleRate);
          if (hz != null) {
            pitchWinRef.current.push({ t: Date.now(), hz });
            const cutoff = Date.now() - 8000;
            pitchWinRef.current = pitchWinRef.current.filter((w) => w.t > cutoff);
          }
        } catch {}
      }, 250);
    } catch {}
  }, [stopPitchTracking]);

  // 3-second owner enrollment: read a line aloud, we store median pitch.
  const enrollVoice = useCallback(async (): Promise<number | null> => {
    const s = await navigator.mediaDevices.getUserMedia(
      micConstraints(useAssistantStore.getState().micDeviceId)
    );
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      try { await ctx.resume(); } catch {}
      const src = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const pitches: number[] = [];
      const buf = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 250));
        analyser.getFloatTimeDomainData(buf);
        const hz = detectPitch(buf, ctx.sampleRate);
        if (hz != null) pitches.push(hz);
      }
      try { s.getTracks().forEach((t) => t.stop()); } catch {}
      try { await ctx.close(); } catch {}
      const med = median(pitches);
      if (med == null) return null;
      useAssistantStore.getState().setVoiceBaseline(Math.round(med));
      return Math.round(med);
    } catch (e) {
      try { s.getTracks().forEach((t) => t.stop()); } catch {}
      throw e;
    }
  }, []);

  const startSilentLoop = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current!;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 0.001;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      osc.start();
      oscRef.current = osc;
    } catch {}
  }, []);

  // Acquire mic + watch it. If a multipoint earbud jumps to another device
  // (laptop call), a background app grabs the mic, or earbuds disconnect,
  // the track ends/mutes -> we notice, tell the user, and auto-reconnect.
  const acquireMic = useCallback(async (isRetry = false) => {
    const st = useAssistantStore.getState();
    if (isRetry && !st.isActive) return;
    try {
      try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      const s = await navigator.mediaDevices.getUserMedia(micConstraints(st.micDeviceId));
      streamRef.current = s;
      retryRef.current = 0;
      st.setMicNotice(null);
      // Mic permission granted => the browser now reveals device labels.
      // Tell any device picker to reload so Bluetooth picks show up.
      try {
        window.dispatchEvent(new Event('onebrain-devices-changed'));
      } catch {}
      // The pitch tracker holds the OLD stream — rebind it whenever the mic
      // is re-acquired (multipoint handover, device switch, iOS resume),
      // otherwise speaker tags silently stop working after any reconnect.
      try {
        if (pitchTimerRef.current) {
          stopPitchTracking();
          startPitchTracking();
        }
      } catch {}
      const track = s.getAudioTracks()[0];
      if (track) {
        track.onended = () => {
          useAssistantStore.getState().logBgEvent('mic-ended');
          if (!useAssistantStore.getState().isActive) return;
          useAssistantStore.getState().setMicNotice('🎧 Earbud mic disconnected (multipoint device may have taken it). Reconnecting…');
          void acquireMic(true);
        };
        track.onmute = () => {
          useAssistantStore.getState().logBgEvent('mic-muted');
          if (useAssistantStore.getState().isActive)
            useAssistantStore.getState().setMicNotice('🔇 Mic muted by system — a call, song app, or another device may be using it.');
        };
        track.onunmute = () => {
          useAssistantStore.getState().logBgEvent('mic-unmuted');
          if (useAssistantStore.getState().isActive) useAssistantStore.getState().setMicNotice(null);
        };
      }
    } catch (e: any) {
      const stNow = useAssistantStore.getState();
      // Figure out what the failure MEANS: pinned device gone, no hardware
      // at all (neckband music-only?), or busy/blocked.
      let plan = diagnoseMicError(e?.name || '', !!stNow.micDeviceId, -1);
      if (plan === 'passthrough' && (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError')) {
        const n = await countAudioInputs().catch(() => -1);
        plan = diagnoseMicError(e?.name || '', !!stNow.micDeviceId, n);
      }
      // Saved mic unplugged (neckband off)? Fall back to the default mic once
      // instead of failing — devices come and go when sharing the phone.
      if (!isRetry && plan === 'retry-default') {
        useAssistantStore.getState().setMicDeviceId(null);
        useAssistantStore.getState().setMicNotice('Saved mic was unplugged — using the default mic.');
        return acquireMic(false);
      }
      if (!isRetry && plan === 'no-hardware') {
        const err: any = new Error('Browser exposes no microphone input at all');
        err.name = 'MicNoHardware';
        throw err;
      }
      if (!isRetry) throw e;
      if (retryRef.current >= 3) {
        useAssistantStore.getState().setMicNotice('Mic wapas nahi mila. Stop dabakar dobara Active karo.');
        return;
      }
      retryRef.current += 1;
      setTimeout(() => { void acquireMic(true); }, 2000);
    }
  }, []);

  // OS switched input/output (earbuds connected, multipoint handover, etc.)
  const handleDevices = useCallback(() => {
    if (!useAssistantStore.getState().isActive) return;
    useAssistantStore.getState().setMicNotice('🔄 Audio device changed — adjusting…');
    void acquireMic(true);
  }, [acquireMic]);

  const setupMediaSession = useCallback(() => {
    try {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'OneBrain Active',
        artist: 'Personal AI',
        album: 'Listening...',
      });
      navigator.mediaSession.setActionHandler('play', () => { if (!useAssistantStore.getState().isActive) (window as any).__onebrain_start?.(); });
      navigator.mediaSession.setActionHandler('pause', () => stopActive());
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        const msgs = useAssistantStore.getState().messages;
        const last = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (last) speak(last.content);
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        const msgs = useAssistantStore.getState().messages;
        const last = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (last) speak(last.content);
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak]);

  const startActive = useCallback(async () => {
    // 1. Mic permission (named error so UI can show exact fix)
    if (!navigator.mediaDevices?.getUserMedia) {
      const err: any = new Error('Microphone API not available');
      err.name = 'MicApiMissing';
      throw err;
    }
    retryRef.current = 0;
    useAssistantStore.getState().setMicNotice(null);
    await acquireMic(false);
    try { navigator.mediaDevices.addEventListener('devicechange', handleDevices); } catch {}
    startSilentLoop();
    startPitchTracking();
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
    } catch {}
    setupMediaSession();
    // Persistent notification: Android lifeline for background + tap-resume.
    // Never allowed to break startup — listening matters more than the note.
    try {
      if (await requestNotificationPermission()) await showActiveNotification();
    } catch {}
    try {
      if ('mediaSession' in navigator) (navigator as any).mediaSession.playbackState = 'playing';
    } catch {}
    store.setIsActive(true);
    store.setCurrentStatus('listening');
    expectingRef.current = true;
    useAssistantStore.getState().markSessionStart();
    useAssistantStore.getState().logBgEvent('session-start', store.settings.language);
    (window as any).__onebrain_start = () => startActive();

    // 2. Speech recognition loop (Web Speech API, free + Hinglish).
    // Recognition language follows Settings so Marathi/Hindi/English each
    // get their own acoustic model instead of one wrong guess.
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const recog = new SR();
      const recogLang: Record<string, string> = { hinglish: 'hi-IN', marathi: 'mr-IN' };
      recog.lang = recogLang[store.settings.language] || store.settings.language || 'en-IN';
      recog.continuous = true;
      recog.interimResults = false;
      recog.onresult = (e: any) => {
        const res = e.results[e.results.length - 1];
        if (!res.isFinal) return;
        const alt = res[0];
        // Ignore very-low-confidence hits: usually background song/TV bleed,
        // not the user. Real speech scores much higher.
        if (typeof alt.confidence === 'number' && alt.confidence < 0.3) return;
        // Clean turn-taking: one final result = one turn. Stop capturing NOW
        // (no runaway listening), process, speak, then resume listening.
        expectingRef.current = false;
        try { recog.stop(); } catch {}
        // Dedupe: continuous mode sometimes re-fires the same final twice.
        const now = Date.now();
        if (alt.transcript === lastFinalRef.current.text && now - lastFinalRef.current.t < 3000) {
          expectingRef.current = true;
          try { recog.start(); } catch {}
          return;
        }
        lastFinalRef.current = { text: alt.transcript, t: now };
        // Roman-script transcript: the AI understands "time kya hai" far
        // better than mixed-script guesses, and chat shows one clean script.
        // Confidence travels along so stranger-voices can be gated precisely.
        const conf = typeof alt.confidence === 'number' ? alt.confidence : undefined;
        handleTranscript(normalizeHinglish(alt.transcript), conf);
      };
      recog.onerror = (e: any) => {
        const err = e?.error || '';
        useAssistantStore.getState().logBgEvent('recog-error', err);
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          useAssistantStore.getState().setMicNotice('Mic permission blocked — address bar ke lock icon se Allow karo.');
        } else if (err === 'audio-capture') {
          useAssistantStore.getState().setMicNotice('🎤 Mic busy hai — laptop (multipoint) ya koi aur app use kar raha hai.');
        }
        // 'network' / 'no-speech' / 'aborted' ignored — loop resumes via onend.
      };
      recog.onend = () => {
        const st = useAssistantStore.getState();
        // Restart ONLY while genuinely expecting input — not while processing,
        // speaking, or between turns. This is what stops endless re-listening.
        const want = st.isActive && !speakingRef.current && expectingRef.current;
        st.logBgEvent('recog-end', want ? 'restarting' : 'paused');
        if (want) {
          try { recog.start(); } catch {}
        }
      };
      recogRef.current = recog;
      try { recog.start(); } catch {}
    } else {
      store.addMessage('assistant', 'Speech recognition not supported in this browser. Type below instead — TTS still works through earbuds.');
    }
  }, [store, handleTranscript, startSilentLoop, setupMediaSession, acquireMic, handleDevices, startPitchTracking]);

  // Called when the page becomes visible again (user returns from another
  // app / notification tap): re-lock wake, refresh the mic, restart recog.
  const recover = useCallback(async () => {
    const st = useAssistantStore.getState();
    if (!st.isActive) return;
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
    } catch {}
    try {
      await acquireMic(true);
    } catch {}
    try {
      recogRef.current?.start();
    } catch {}
    useAssistantStore.getState().setCurrentStatus('listening');
    expectingRef.current = true;
  }, [acquireMic]);

  const stopActive = useCallback(() => {
    try { navigator.mediaDevices.removeEventListener('devicechange', handleDevices); } catch {}
    speakingRef.current = false;
    expectingRef.current = false;
    stopPitchTracking();
    void dismissActiveNotification();
    try { recogRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try { oscRef.current?.stop(); audioCtxRef.current?.close(); } catch {}
    try { wakeLockRef.current?.release(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    retryRef.current = 0;
    store.setIsActive(false);
    store.setCurrentStatus('idle');
    store.setMicNotice(null);
  }, [store, handleDevices, stopPitchTracking]);

  // Fill the cross-call ref now that every callback exists.
  controlsRef.current = { stopActive, startActive, speak };

  return {
    startActive,
    stopActive,
    speak,
    handleTranscript,
    enrollVoice,
    recover,
    isActive: store.isActive,
    currentStatus: store.currentStatus,
    messages: store.messages,
    micNotice: store.micNotice,
  };
}
