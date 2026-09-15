// Scrub chat text into speakable sentences: no emojis, no markdown,
// no URLs - speech engines read every character literally.
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

// Pick a TTS voice locale matching the reply's script, so Marathi answers
// don't come out in an English voice (and vice versa).
export function ttsLangFor(text: string, preferred: string): string {
  const t = text || '';
  if (/[\u0900-\u097F]/.test(t)) return preferred === 'marathi' ? 'mr-IN' : 'hi-IN';
  if (/[\u0A00-\u0A7F]/.test(t)) return 'pa-IN';
  if (/[\u0A80-\u0AFF]/.test(t)) return 'gu-IN';
  if (/[\u0980-\u09FF]/.test(t)) return 'bn-IN';
  if (/[\u0B00-\u0B7F]/.test(t)) return 'or-IN';
  if (/[\u0B80-\u0BFF]/.test(t)) return 'ta-IN';
  if (/[\u0C00-\u0C7F]/.test(t)) return 'te-IN';
  if (/[\u0C80-\u0CFF]/.test(t)) return 'kn-IN';
  if (/[\u0D00-\u0D7F]/.test(t)) return 'ml-IN';
  if (/[\u0600-\u06FF]/.test(t)) return 'ar-SA';
  if (/[\u4E00-\u9FFF]/.test(t)) return 'zh-CN';
  if (/[\u3040-\u30FF]/.test(t)) return 'ja-JP';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko-KR';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru-RU';
  return preferred === 'hi-IN' ? 'hi-IN' : 'en-IN';
}

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
export function pickTtsVoice<V extends VoiceLike>(
  voices: V[] | null | undefined,
  lang: string,
): VoiceChoice<V> {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
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

  // 1. Exact tag: `mr-IN` when `mr-IN` is installed.
  const exact = list.find((v) => normLang(v?.lang) === want);
  if (exact) return found(exact, 'exact');

  // 2. Same language, other script/region: `hi-Latn-IN` for `hi-IN`.
  const sameLang =
    list.find((v) => baseLang(v?.lang) === wantBase && normLang(v?.lang).startsWith(wantBase + '-')) ||
    list.find((v) => baseLang(v?.lang) === wantBase);
  if (sameLang) return found(sameLang, 'language');

  // 3. Related script family (Marathi -> Hindi).
  for (const rel of RELATED_LANGS[wantBase] || []) {
    const hit =
      list.find((v) => normLang(v?.lang) === `${rel}-in`) ||
      list.find((v) => baseLang(v?.lang) === rel);
    if (hit) return found(hit, 'related');
  }

  // 4. Any voice at all — prefer an Indian English one so names/pronunciation
  //    stay close, then the engine default, then whatever is first.
  const any =
    list.find((v) => normLang(v?.lang) === 'en-in') ||
    list.find((v) => baseLang(v?.lang) === 'en') ||
    list.find((v) => v?.default === true) ||
    list[0];
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

// Break a cleaned reply into utterance-sized pieces. Chrome's speechSynthesis
// goes quiet mid-sentence on long utterances (~15 s on desktop; Android may
// end without firing any event), so each chunk stays comfortably short and
// splits only on sentence/clause boundaries — never mid-word.
export function splitForSpeech(text: string, maxChars = 180): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];
  // Sentence enders in Latin scripts plus the Devanagari danda (।).
  const sentences = t.match(/[^.!?।]+[.!?।]*\s*/g) || [t];
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length > maxChars) {
      flush();
      // One very long sentence: split on commas/semicolons, then on spaces.
      let piece = '';
      for (const part of s.split(/(?<=[,;:])\s+/)) {
        if ((piece + ' ' + part).trim().length > maxChars && piece) {
          out.push(piece.trim());
          piece = '';
        }
        if (part.length > maxChars) {
          for (const word of part.split(' ')) {
            if ((piece + ' ' + word).trim().length > maxChars && piece) {
              out.push(piece.trim());
              piece = '';
            }
            piece = (piece + ' ' + word).trim();
          }
        } else {
          piece = (piece + ' ' + part).trim();
        }
      }
      if (piece) out.push(piece);
      continue;
    }
    if ((buf + ' ' + s).trim().length > maxChars) flush();
    buf = (buf + ' ' + s).trim();
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Browser-voice fallback (used only when real reply audio is unavailable)
//
// Two engine bugs made this path look like "the app is broken":
//   1. cancel() immediately followed by speak() drops the utterance on iOS
//      Safari and macOS Safari — no start event, no error, just silence.
//   2. Setting u.voice to a voice whose language differs from u.lang (a Hindi
//      request answered by an English voice, say) also goes silent on some
//      Android/Chrome builds.
// Both are handled here, plus a one-shot retry with the engine default voice,
// so a failure produces a reason instead of nothing.
// ---------------------------------------------------------------------------

/** Keep `u.voice` and `u.lang` consistent — a mismatch is silent on some engines. */
export function utteranceVoicePlan<V extends VoiceLike>(
  choice: VoiceChoice<V> | null | undefined,
  requestedLang: string,
): { voice: V | null; lang: string } {
  const voice = (choice?.voice as V) || null;
  // Keep the exact tag the engine reported (BCP-47 is case-insensitive, but
  // some engines match the string they published more eagerly).
  const requested = String(requestedLang || '').trim() || 'en-IN';
  const voiceLang = String(choice?.lang || voice?.lang || '').trim();
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

  // Clear any stuck/queued speech first, then let the engine settle. Doing
  // this in the same tick as speak() is what swallows the utterance on Safari.
  try {
    synth.cancel();
  } catch {}
  await sleep(30);
  if (cancelled || !current()) return 'cancelled';

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

  for (const chunk of chunks) {
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
    if (outcome === 'ok') continue;
    return outcome;
  }
  return 'ok';
}
