// Scrub chat text into speakable sentences: no emojis, no markdown,
// no URLs - speech engines read every character literally.
import { signalSpeechPlayback } from './audio';
import { voiceLanguageById } from '../locale/voice-languages';
import { looksEnglish, scriptLanguage, type ScriptLanguage } from '../locale/text-language';

export function cleanForSpeech(input: string): string {
  let t = input || '';

  // Fenced code blocks: keep inner text, drop fences
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '));
  // Inline code
  t = t.replace(/`([^`]*)`/g, '$1');
  // Images ![alt](url) -> alt ; links [text](url) -> text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Bare URLs are useless aloud
  t = t.replace(/https?:\/\/[^\s)]+/g, ' ');
  // Headings, quotes, list markers, table pipes, rules
  t = t.replace(/^#{1,6}\s*/gm, '');
  t = t.replace(/^>\s?/gm, '');
  t = t.replace(/^\s*([-*+]|\d+[.)])\s+/gm, '');
  t = t.replace(/\|/g, ' ');
  t = t.replace(/^(\*\*\*|---|___)\s*$/gm, ' ');
  // Bold / italic / strikethrough: keep words, drop markers
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2');
  t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1$2');
  t = t.replace(/~~(.*?)~~/g, '$1');
  // Any leftover markdown characters
  t = t.replace(/[*_~#`]/g, '');
  // Emojis/symbols: filtered by code point (no fragile giant regex).
  // Covers misc symbols, dingbats, arrows, shapes, emoticons, pictographs.
  t = stripEmoji(t);
  // Abbreviations spoken naturally
  t = t.replace(/\be\.g\./gi, 'for example');
  t = t.replace(/\bi\.e\./gi, 'that is');
  t = t.replace(/\betc\./gi, 'etcetera');
  t = t.replace(/\bvs\./gi, 'versus');
  // Line breaks become pauses
  t = t.replace(/\s*\n+\s*/g, '. ');
  // Tidy spaces and repeated punctuation
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/([?!.,:;])\1+/g, '$1');
  t = t.replace(/\s+([?!.,:;])/g, '$1');
  return t.trim();
}

// Split a bilingual reply: spoken part in the user language, plus an
// optional short English version after a ---EN--- line.
export function splitReply(answer: string): { spoken: string; english: string | null } {
  const idx = (answer || '').indexOf('---EN---');
  if (idx === -1) return { spoken: (answer || '').trim(), english: null };
  const spoken = answer.slice(0, idx).trim();
  const english = answer.slice(idx + '---EN---'.length).trim();
  if (!english) return { spoken: spoken || answer.trim(), english: null };
  return { spoken: spoken || english, english };
}

// Pick the voice that should read this text. Non-Latin scripts choose their
// own language (a Marathi answer never comes out in an English voice);
// Latin-script text uses the user's voice language, except English text
// inside a non-English setting, which gets the user's English accent.
// `language` is a resolved voice-language id (see lib/locale), never "auto".
export function ttsLangFor(text: string, language: string, englishTag = 'en-US'): string {
  const voice = voiceLanguageById(language);
  const t = text || '';
  if (/[\u0900-\u097F]/.test(t)) return voice?.id === 'marathi' ? 'mr-IN' : 'hi-IN';
  if (/[\u0A00-\u0A7F]/.test(t)) return 'pa-IN';
  if (/[\u0A80-\u0AFF]/.test(t)) return 'gu-IN';
  if (/[\u0980-\u09FF]/.test(t)) return 'bn-IN';
  if (/[\u0B00-\u0B7F]/.test(t)) return 'or-IN';
  if (/[\u0B80-\u0BFF]/.test(t)) return 'ta-IN';
  if (/[\u0C00-\u0C7F]/.test(t)) return 'te-IN';
  if (/[\u0C80-\u0CFF]/.test(t)) return 'kn-IN';
  if (/[\u0D00-\u0D7F]/.test(t)) return 'ml-IN';
  const script = scriptLanguage(t);
  if (script) return voice?.reply === script ? voice.tts : SCRIPT_VOICE[script];
  if (/[\u0400-\u04FF]/.test(t)) return 'ru-RU';
  if (!voice) return englishTag;
  switch (voice.reply) {
    case 'english':
      return voice.tts;
    case 'hinglish':
    case 'marathi':
      return 'en-IN'; // Roman-script Hinglish/Marathi reads best in an Indian English voice
    case 'hindi':
      return 'hi-IN';
    case 'japanese':
    case 'korean':
    case 'chinese':
    case 'arabic':
      return englishTag; // Latin text in a non-Latin-script setting is English
    default:
      return looksEnglish(t, voice.reply) ? englishTag : voice.tts;
  }
}

const SCRIPT_VOICE: Record<ScriptLanguage, string> = {
  japanese: 'ja-JP',
  korean: 'ko-KR',
  chinese: 'zh-CN',
  arabic: 'ar-SA',
};

// Code points to drop: [start, end] pairs as hex numbers (no giant regex).
const DROP_RANGES: Array<[number, number]> = [
  [0x2600, 0x27bf], // misc symbols, dingbats, arrows supplement
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f000, 0x1faff], // emoticons, pictographs, symbols, flags
  [0x2190, 0x21ff], // arrows
  [0x2300, 0x23ff], // misc technical
  [0x25a0, 0x25ff], // geometric shapes
  [0x200d, 0x200d], // zero-width joiner
];

function stripEmoji(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    let drop = false;
    for (const [a, b] of DROP_RANGES) {
      if (cp >= a && cp <= b) {
        drop = true;
        break;
      }
    }
    if (!drop) out += ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Voice availability
//
// Two silent failures used to make OneBrain "text only" with no explanation:
//   1. Chrome/Safari return an EMPTY voice list on the first getVoices() call
//      and fill it in asynchronously (voiceschanged). Speaking immediately
//      picks no voice and — depending on engine — says nothing.
//   2. u.lang pointing at a language with no installed voice (mr-IN on a
//      stock Android, say) queues an utterance that never starts. No error,
//      no sound.
// Both are now detected, degraded to an audible alternative, and reported.
// ---------------------------------------------------------------------------

export type VoiceMatch = 'exact' | 'language' | 'related' | 'any' | 'none';

export interface VoiceLike {
  name?: string;
  lang?: string;
  default?: boolean;
}

export interface VoiceChoice<V extends VoiceLike = VoiceLike> {
  voice: V | null;
  match: VoiceMatch;
  /** Language that will actually be spoken; differs from the request when we fell back. */
  lang: string | null;
  /** Human label for the voice we settled on, for the UI. */
  name: string | null;
}

/** BCP-47 tags arrive as `mr-IN`, `mr_IN`, `MR-in`; compare them safely. */
export function normLang(tag: string | undefined | null): string {
  return String(tag || '').trim().toLowerCase().replace(/_/g, '-');
}

/** `hi-Latn-IN` -> `hi`. Script/region stripped for a coarse comparison. */
export function baseLang(tag: string | undefined | null): string {
  return normLang(tag).split('-')[0] || '';
}

// Marathi text is readable by a Hindi voice (same Devanagari script), so when
// mr-IN is missing we prefer hi-IN over falling all the way back to English —
// audible and close, instead of silent or unreadable.
const RELATED_LANGS: Record<string, string[]> = {
  mr: ['hi'],
  hi: ['mr'],
  pa: ['hi'],
  gu: ['hi'],
};

/**
 * Pick the best installed voice for `lang`, never returning "nothing" when
 * *some* voice exists: silence is worse than a slightly wrong accent.
 */
// Novelty and retro voices shipped with macOS/iOS ("Albert", "Bubbles", the
// Eloquence set "Eddy", "Flo"…). Engines often list them first alphabetically,
// so without this a US reply could come out as "Albert". Last resort only.
const NOVELTY_VOICE =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|deranged|hysterical|princess|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/**
 * How natural a voice sounds, from what engines put in the name. Edge's
 * "Online (Natural)" and Apple's Premium/Enhanced voices are neural; Chrome's
 * "Google …" voices are network voices; bare OS voices are the robotic ones.
 */
export function voiceQuality(v: VoiceLike & { localService?: boolean }): number {
  const name = String(v?.name || '');
  let score = 0;
  if (/natural|neural/i.test(name)) score += 50;
  if (/premium/i.test(name)) score += 45;
  if (/enhanced/i.test(name)) score += 40;
  if (/^google\b/i.test(name)) score += 30;
  if (/\bonline\b|network/i.test(name)) score += 20;
  // Apple's good built-in voices per English accent.
  if (/\b(samantha|alex|ava|zoe|allison|susan|tom|daniel|kate|serena|oliver|karen|lee|catherine|moira|tessa|rishi|veena)\b/i.test(name)) score += 15;
  if (/espeak|robot/i.test(name)) score -= 50;
  if (v?.localService === false) score += 5;
  if (v?.default) score += 3;
  return score;
}

// When the exact accent is missing, the nearest one: an Australian hears a
// New Zealand or British voice before an American one.
const CLOSE_ACCENTS: Record<string, string[]> = {
  'en-au': ['en-nz', 'en-gb'], 'en-nz': ['en-au', 'en-gb'], 'en-gb': ['en-ie', 'en-au'],
  'en-ie': ['en-gb'], 'en-za': ['en-gb'], 'en-in': ['en-gb'], 'en-sg': ['en-gb'],
  'en-ca': ['en-us'], 'en-us': ['en-ca'], 'es-mx': ['es-us'], 'es-us': ['es-mx'],
  'fr-ca': ['fr-fr'], 'pt-pt': ['pt-br'], 'pt-br': ['pt-pt'], 'zh-tw': ['zh-hk', 'zh-cn'],
};

export function pickTtsVoice<V extends VoiceLike>(
  voices: V[] | null | undefined,
  lang: string,
): VoiceChoice<V> {
  const all = Array.isArray(voices) ? voices.filter(Boolean) : [];
  const usable = all.filter((v) => !NOVELTY_VOICE.test(String(v?.name || '')));
  const list = usable.length ? usable : all;
  const want = normLang(lang);
  const wantBase = baseLang(want);
  const none: VoiceChoice<V> = { voice: null, match: 'none', lang: null, name: null };
  if (!list.length) return none;

  const found = (voice: V, match: VoiceMatch): VoiceChoice<V> => ({
    voice,
    match,
    lang: normLang(voice?.lang) || want || null,
    name: String(voice?.name || 'System voice'),
  });
  /** The most natural-sounding voice; ties keep the engine's own order. */
  const best = (candidates: V[]): V =>
    candidates.reduce((a, b) => (voiceQuality(b) > voiceQuality(a) ? b : a));

  // 1. Exact tag: `en-AU` when an `en-AU` voice is installed (the most natural one).
  const exact = list.filter((v) => normLang(v?.lang) === want);
  if (exact.length) return found(best(exact), 'exact');

  // 2. Same language: nearest accent first, then a tag with a region/script
  //    (`hi-Latn-IN`) over a bare one, then naturalness.
  const same = list.filter((v) => baseLang(v?.lang) === wantBase);
  if (same.length) {
    const close = CLOSE_ACCENTS[want] || [];
    const rank = (v: V) => {
      const tag = normLang(v?.lang);
      const i = close.indexOf(tag);
      return i !== -1 ? i : tag.startsWith(`${wantBase}-`) ? close.length : close.length + 1;
    };
    const sorted = [...same].sort((a, b) => rank(a) - rank(b) || voiceQuality(b) - voiceQuality(a));
    return found(sorted[0], 'language');
  }

  // 3. Related script family (Marathi -> Hindi).
  for (const rel of RELATED_LANGS[wantBase] || []) {
    const regional = list.filter((v) => normLang(v?.lang) === `${rel}-in`);
    const family = list.filter((v) => baseLang(v?.lang) === rel);
    if (regional.length || family.length) return found(best(regional.length ? regional : family), 'related');
  }

  // 4. Any voice at all — English from the same region first (Tamil -> Indian
  //    English keeps names close), then the most natural English, then the
  //    engine default, then whatever is first.
  const region = want.split('-').slice(1).find((p) => p.length === 2);
  const regionalEnglish = region ? list.filter((v) => normLang(v?.lang) === `en-${region}`) : [];
  const english = list.filter((v) => baseLang(v?.lang) === 'en');
  const any = regionalEnglish.length
    ? best(regionalEnglish)
    : english.length
      ? best(english)
      : list.find((v) => v?.default === true) || list[0];
  return found(any, 'any');
}

function safeVoices(synth: any): any[] {
  try {
    const v = synth?.getVoices?.();
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Resolve the engine's voice list, waiting out Chrome's empty first answer.
 * Always resolves (never rejects) so a stuck engine cannot hang a reply.
 */
export function waitForVoices(synth: any, timeoutMs = 1500): Promise<any[]> {
  const early = safeVoices(synth);
  if (early.length) return Promise.resolve(early);
  return new Promise((resolve) => {
    if (!synth || typeof synth.addEventListener !== 'function') {
      resolve([]);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        synth.removeEventListener?.('voiceschanged', onChange);
      } catch {}
      resolve(safeVoices(synth));
    };
    const onChange = () => {
      if (safeVoices(synth).length) finish();
    };
    const timer = setTimeout(finish, Math.max(0, timeoutMs));
    try {
      synth.addEventListener('voiceschanged', onChange);
    } catch {
      finish();
      return;
    }
    // Some engines populate without ever firing the event; poll briefly.
    const started = Date.now();
    const poll = setInterval(() => {
      if (safeVoices(synth).length || Date.now() - started > timeoutMs) {
        clearInterval(poll);
        finish();
      }
    }, 60);
    // Do not leak the interval past the timeout if finish() already ran.
    setTimeout(() => clearInterval(poll), timeoutMs + 50);
  });
}

export type TtsLevel = 'ok' | 'warn' | 'blocked';

export interface TtsHealth {
  level: TtsLevel;
  code:
    | 'ready'
    | 'silent-mode'
    | 'unsupported'
    | 'no-voices'
    | 'substitute-voice';
  /**
   * True only when speaking is impossible or unwanted, so the caller should
   * not even try. An EMPTY voice list is deliberately NOT blocking: Chrome and
   * Android routinely report getVoices() === [] and still speak through the OS
   * default voice. Those attempts are made, and the stall/error handlers
   * report it if they genuinely produce nothing.
   */
  blocking: boolean;
  /** null when nothing needs telling. */
  message: string | null;
  hint: string | null;
}

/**
 * Turn the raw state of the speech engine into something a person can act on.
 * Called before every reply so "he doesn't talk" always has a visible reason.
 */
export function diagnoseTts(input: {
  silentMode?: boolean;
  synthSupported?: boolean;
  voices: VoiceLike[] | null | undefined;
  choice?: VoiceChoice | null;
  lang?: string;
}): TtsHealth {
  if (input.silentMode) {
    return {
      level: 'blocked',
      code: 'silent-mode',
      blocking: true,
      message: 'Silent Mode is on — answers are text only.',
      hint: 'Turn off Silent Mode in the workspace header or Settings → Voice to hear replies.',
    };
  }
  if (input.synthSupported === false) {
    return {
      level: 'blocked',
      code: 'unsupported',
      blocking: true,
      message: 'This browser has no speech engine, so replies cannot be spoken.',
      hint: 'Chrome, Edge or Safari can speak. Some in-app browsers cannot.',
    };
  }
  const voices = Array.isArray(input.voices) ? input.voices : [];
  if (!voices.length) {
    // Warn, then try anyway — see `blocking` above.
    return {
      level: 'warn',
      code: 'no-voices',
      blocking: false,
      message: 'The browser lists no speech voices; trying the system default.',
      hint: 'If nothing is spoken, install a voice in your system Text-to-speech settings (Android: Accessibility → Text-to-speech output; iPhone: Accessibility → Spoken Content → Voices).',
    };
  }
  const choice = input.choice;
  if (choice && (choice.match === 'any' || choice.match === 'related')) {
    const want = input.lang ? input.lang.toUpperCase() : 'that language';
    return {
      level: 'warn',
      code: 'substitute-voice',
      blocking: false,
      message: `No ${want} voice installed — speaking with ${choice.name} (${choice.lang || 'unknown'}).`,
      hint: 'Install a voice for that language in your system Text-to-speech settings for a natural accent.',
    };
  }
  return { level: 'ok', code: 'ready', blocking: false, message: null, hint: null };
}

// Sentence-aware splitting lives in a DOM-free module so the server voice can
// share it; re-exported here for existing callers.
export { splitForSpeech, splitForProgressiveSpeech } from './speech-split';

// ---------------------------------------------------------------------------
// Browser-voice fallback (used only when real reply audio is unavailable)
//
// Engine behaviours that made this path look like "the app is broken":
//   1. iOS WebKit silently DROPS speak() — no event, nothing queued — until one
//      speak() has run inside a user gesture. That unlock lives in
//      lib/voice/audio.ts (unlockAudioOutput / primeAudioOutputOnGesture); this file
//      only reports it truthfully when it happens ('stalled').
//   2. cancel() immediately followed by speak() can drop the utterance on
//      Safari. So the engine is only cancelled when it is actually busy, and
//      then given time to settle before the next speak().
//   3. Setting u.voice to a voice whose language differs from u.lang (a Hindi
//      request answered by an English voice, say) goes silent on some
//      Android/Chrome builds.
// All are handled here, plus a one-shot retry with the engine default voice,
// so a failure produces a reason instead of nothing.
// ---------------------------------------------------------------------------

/** Keep `u.voice` and `u.lang` consistent — a mismatch is silent on some engines. */
export function utteranceVoicePlan<V extends VoiceLike>(
  choice: VoiceChoice<V> | null | undefined,
  requestedLang: string,
): { voice: V | null; lang: string } {
  const voice = (choice?.voice as V) || null;
  // Keep the exact tag the engine published ("en-IN", not our normalised
  // "en-in"): BCP-47 is case-insensitive, but Apple's voice lookup is not.
  const requested = String(requestedLang || '').trim() || 'en-US';
  const voiceLang = String(voice?.lang || choice?.lang || '').trim();
  if (voice) return { voice, lang: voiceLang || requested };
  return { voice: null, lang: requested };
}

export type BrowserSpeakOutcome = 'ok' | 'unsupported' | 'stalled' | 'error' | 'cancelled';

export interface BrowserSpeakOptions {
  rate: number;
  choice?: VoiceChoice | null;
  lang: string;
  /** False when a newer reply/session replaced this one. */
  isCurrent?: () => boolean;
  onEvent?: (event: BrowserSpeakOutcome | 'start', detail?: string) => void;
  /**
   * Cumulative characters of `chunks` actually spoken, reported after each
   * chunk finishes. This is the resume point when the user interrupts: it only
   * ever lands on a chunk boundary, so nothing is half-said twice.
   */
  onProgress?: (charsSpoken: number) => void;
  /** Handed a cancel function so the caller can abort mid-reply. */
  registerCancel?: (cancel: () => void) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Speak chunks through the browser voice engine, resolving with WHY it
 * stopped so the UI can tell the user something true.
 */
export async function speakChunksWithBrowserVoice(
  synth: any,
  chunks: string[],
  opts: BrowserSpeakOptions,
): Promise<BrowserSpeakOutcome> {
  const Utter: any =
    typeof (globalThis as any).SpeechSynthesisUtterance !== 'undefined'
      ? (globalThis as any).SpeechSynthesisUtterance
      : typeof window !== 'undefined'
        ? (window as any).SpeechSynthesisUtterance
        : undefined;
  if (!synth || typeof synth.speak !== 'function' || !Utter) {
    opts.onEvent?.('unsupported', 'no speechSynthesis');
    return 'unsupported';
  }

  const current = opts.isCurrent || (() => true);
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    try {
      synth.cancel();
    } catch {}
  };
  opts.registerCancel?.(cancel);

  const rate = Math.min(2, Math.max(0.1, Number(opts.rate) || 1));
  const plan = utteranceVoicePlan(opts.choice || null, opts.lang);

  // Clear stuck/queued speech only when there is some. cancel() on an idle
  // engine achieves nothing, and cancel() right before speak() is exactly what
  // swallows the utterance on Safari — so when we do cancel, let it settle.
  let busy = false;
  try {
    busy = !!synth.speaking || !!synth.pending;
  } catch {}
  if (busy) {
    try {
      synth.cancel();
    } catch {}
    await sleep(120);
    if (cancelled || !current()) return 'cancelled';
  }

  /** One utterance; resolves 'ok' | 'stalled' | 'error' | 'cancelled'. */
  const speakOne = (text: string, useVoice: boolean): Promise<BrowserSpeakOutcome> =>
    new Promise<BrowserSpeakOutcome>((resolve) => {
      let started = false;
      let finished = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let u: any;
      const done = (outcome: BrowserSpeakOutcome, detail?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        if (u) {
          u.onstart = null;
          u.onend = null;
          u.onerror = null;
        }
        if (outcome !== 'ok') opts.onEvent?.(outcome, detail);
        resolve(outcome);
      };
      try {
        u = new Utter(text);
        u.rate = rate;
        u.lang = plan.lang;
        if (useVoice && plan.voice) {
          try {
            u.voice = plan.voice;
          } catch {}
        }
        u.onstart = () => {
          started = true;
          opts.onEvent?.('start', plan.lang);
          clearTimeout(watchdog);
          // Generous per-chunk ceiling; real speech always ends sooner.
          watchdog = setTimeout(() => cancel(), 60_000);
        };
        u.onend = () => done('ok');
        u.onerror = (ev: any) => {
          const code = String(ev?.error || 'unknown');
          const benign = code === 'interrupted' || code === 'canceled';
          done(benign ? 'cancelled' : 'error', code);
        };
        // Never hang on a speak() that never starts. Only when the engine
        // POSITIVELY reports an idle queue (not speaking, nothing pending) is
        // the utterance treated as stalled — engines that merely skip the
        // start event keep the generous per-chunk ceiling instead, so a reply
        // that is genuinely playing is never cut off.
        watchdog = setTimeout(() => {
          if (started) return;
          if (synth.speaking !== false || synth.pending !== false) {
            started = true;
            watchdog = setTimeout(() => cancel(), 60_000);
            return;
          }
          done('stalled', 'no start event');
        }, 5000);
        try {
          if (synth.paused) synth.resume();
        } catch {}
        synth.speak(u);
      } catch (e: any) {
        done('error', e?.name || 'speak threw');
      }
    });

  // Music ducking: the browser voice also owns the speaker, so announce the
  // whole reply, not just the synthesized-blob path in lib/voice/audio.ts.
  signalSpeechPlayback('start');
  let spokenChars = 0;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (cancelled || !current()) return 'cancelled';
      let outcome = await speakOne(chunk, true);
      // Retry once without pinning a voice: an installed-but-broken voice pack
      // must not turn the whole reply silent.
      if (outcome === 'stalled' && plan.voice) {
        try {
          synth.cancel();
        } catch {}
        await sleep(30);
        if (cancelled || !current()) return 'cancelled';
        outcome = await speakOne(chunk, false);
      }
      if (outcome === 'ok') {
        // Count the space that joined this chunk to the next one, so a reply
        // heard to the end reports its full length — a few characters short
        // read as "interrupted" and offered a bogus "continue".
        spokenChars += chunk.length + (i < chunks.length - 1 ? 1 : 0);
        opts.onProgress?.(spokenChars);
        continue;
      }
      return outcome;
    }
    return 'ok';
  } finally {
    signalSpeechPlayback('end');
  }
}
