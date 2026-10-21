// Server-side text-to-speech for OneBrain replies: real spoken audio bytes.
//
// Why this exists: browser speechSynthesis is the least reliable audio path on
// the platforms people actually use. It cannot be routed to a chosen speaker
// (setSinkId does not apply to it), iOS Safari drops it until the page has
// spoken once inside a tap, Android Chrome frequently reports zero voices, and
// several engines swallow utterances with no error event at all.
//
// Audio BYTES play through an <audio> element instead, which every platform
// supports, follows the OS output automatically (neckband / earbuds / speaker),
// can be pinned with setSinkId on Chromium, shows up on the lock screen — and
// on iPhone is not muted by the Ring/Silent switch.
//
// Hosting cost stays at zero: HOST provider keys are never read here. Ordered:
//   1. the user's own Gemini key (their quota, their plan) — best quality;
//   2. a keyless read-aloud voice, so zero-setup users still get sound;
//   3. `{ fallback: true }` — the client then uses the browser voice.
//
// Every tier is time-boxed so this route answers before the client gives up
// on it, and the client always has a working fallback, so a provider outage
// degrades to the browser voice instead of silence.

import { splitForSpeech } from '../voice/speech-split';

export const MAX_TEXT = 1500;
export const MAX_KEY = 256;
export const MAX_LANG = 32;

// 24 kHz mono 16-bit PCM is what Gemini TTS returns; browsers will not play
// raw PCM, so it is wrapped in a WAV container before it leaves this route.
const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS = 16;

const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.0-flash-preview-tts'];

// A handful of distinct voice names so replies do not all sound identical.
export function geminiVoiceFor(lang: string): string {
  const base = String(lang || '').toLowerCase().split('-')[0];
  const map: Record<string, string> = {
    hi: 'Kore',
    mr: 'Kore',
    bn: 'Kore',
    ta: 'Kore',
    te: 'Kore',
    gu: 'Kore',
    kn: 'Kore',
    ml: 'Kore',
    pa: 'Kore',
    ur: 'Kore',
    ar: 'Charon',
    es: 'Aoede',
    fr: 'Aoede',
    de: 'Charon',
  };
  return map[base] || 'Puck';
}

/** Base64 (possibly data-URL wrapped) -> bytes. */
export function base64ToBytes(input: string): Uint8Array {
  const raw = String(input || '');
  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma !== -1 ? raw.slice(comma + 1) : raw;
  const cleaned = b64.replace(/\s+/g, '');
  if (!cleaned) return new Uint8Array(0);
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Wrap raw little-endian PCM in a minimal RIFF/WAVE header. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = PCM_SAMPLE_RATE,
  channels = PCM_CHANNELS,
  bits = PCM_BITS,
): Uint8Array {
  const dataSize = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  const out = new Uint8Array(44 + dataSize);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export type SpeechBytes = { bytes: Uint8Array; mime: string };

/** Milliseconds left before `deadline` (an epoch-ms timestamp). */
const timeLeft = (deadline: number) => deadline - Date.now();

/**
 * Speech built on the CALLER's own key. Their plan, their quota — the host
 * never spends anything. Returns null on any failure so the next tier runs.
 */
export async function userKeySpeech(
  text: string,
  lang: string,
  userKey: string,
  deadline = Date.now() + 12_000,
): Promise<SpeechBytes | null> {
  for (const model of GEMINI_TTS_MODELS) {
    const left = timeLeft(deadline);
    if (left < 500) break;
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': userKey },
          signal: AbortSignal.timeout(left),
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                ...(lang ? { languageCode: lang } : {}),
                voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoiceFor(lang) } },
              },
            },
          }),
        },
      );
      if (!r.ok) continue;
      const j: any = await r.json();
      const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
      const data = part?.inlineData?.data;
      if (typeof data !== 'string' || !data) continue;
      const bytes = base64ToBytes(data);
      if (bytes.byteLength < 100) continue;
      const mime = String(part?.inlineData?.mimeType || '');
      // Raw PCM (audio/L16) must be wrapped; anything already playable passes through.
      if (/l16|pcm/i.test(mime) || !/^audio\/(mpeg|mp3|wav|ogg|webm|mp4)/i.test(mime)) {
        return { bytes: pcmToWav(bytes), mime: 'audio/wav' };
      }
      return { bytes, mime };
    } catch {
      // try the next model / tier
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keyless read-aloud voice (Google Translate's public text-to-speech)
//
// The keyless model this route used before (Pollinations `openai-audio`) was
// withdrawn — it now answers "Model not found" — so every zero-setup user lost
// spoken replies and fell back to the browser voice, which iPhones refuse to
// start until the page has been tapped. Google Translate's read-aloud voice
// needs no key, answers in well under a second, and speaks every language this
// app uses — English in the user's own accent (US, UK, Australian, Canadian,
// Indian, Irish, South African: one Google domain each, as gTTS documents),
// Spanish, French, Portuguese, German, Japanese, Hindi, Marathi and more.
//
// It is an unofficial endpoint, so: requests stay within its 200-character
// limit, everything is time-boxed, nothing is retried in a loop, and any
// failure returns null so the browser voice takes over.
// ---------------------------------------------------------------------------

// Languages Google's read-aloud voice speaks (the list gTTS ships).
const READ_ALOUD_LANGS = new Set([
  'af', 'am', 'ar', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu',
  'fi', 'fr', 'gl', 'gu', 'ha', 'hi', 'hr', 'hu', 'id', 'is', 'it', 'iw', 'ja', 'jw', 'km', 'kn',
  'ko', 'la', 'lt', 'lv', 'ml', 'mr', 'ms', 'my', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru',
  'si', 'sk', 'sq', 'sr', 'su', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi',
]);
const READ_ALOUD_ALIASES: Record<string, string> = { he: 'iw', jv: 'jw', fil: 'tl', nb: 'no', nn: 'no' };
const READ_ALOUD_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
/** translate_tts accepts up to 200 characters per request. */
export const READ_ALOUD_GET_MAX = 180;
/** The batchexecute RPC accepts up to 100 characters per request (as gTTS uses it). */
export const READ_ALOUD_RPC_MAX = 100;
const READ_ALOUD_PARALLEL = 3;
const READ_ALOUD_REQUEST_MS = 4_500;

// Accent by Google domain, as documented by gTTS ("Localized accents"). The
// plain .com domain picks an accent from the *server's* network location, so
// regional languages always name their domain explicitly.
const READ_ALOUD_ACCENT: Record<string, Record<string, string>> = {
  en: { us: 'us', gb: 'co.uk', uk: 'co.uk', au: 'com.au', nz: 'com.au', ca: 'ca', in: 'co.in', ie: 'ie',
    za: 'co.za', ng: 'com.ng', sg: 'co.uk', '': 'us' },
  fr: { ca: 'ca', '': 'fr' },
  pt: { pt: 'pt', '': 'com.br' },
  es: { es: 'es', us: 'us', mx: 'com.mx', ar: 'com.mx', co: 'com.mx', cl: 'com.mx', pe: 'com.mx', '': 'es' },
};

/** Google read-aloud language + host for a BCP-47 tag; null when unsupported. */
export function readAloudTarget(lang: string): { tl: string; host: string } | null {
  const norm = String(lang || '').trim().toLowerCase().replace(/_/g, '-');
  const [rawBase = '', region = ''] = norm.split('-');
  if (!rawBase) return { tl: 'en', host: 'translate.google.us' };
  if (rawBase === 'zh') {
    return { tl: region === 'tw' || region === 'hk' ? 'zh-TW' : 'zh-CN', host: 'translate.google.com' };
  }
  const base = READ_ALOUD_ALIASES[rawBase] || rawBase;
  if (!READ_ALOUD_LANGS.has(base)) return null;
  const accents = READ_ALOUD_ACCENT[base];
  const tld = accents ? (Object.prototype.hasOwnProperty.call(accents, region) ? accents[region] : accents['']) : 'com';
  return { tl: base, host: `translate.google.${tld}` };
}

/** The read-aloud GET URL for one piece of text. */
export function readAloudUrl(host: string, tl: string, q: string, idx = 0, total = 1): string {
  const params = new URLSearchParams({
    ie: 'UTF-8',
    client: 'tw-ob',
    tl,
    q,
    total: String(total),
    idx: String(idx),
    textlen: String(q.length),
  });
  return `https://${host}/translate_tts?${params.toString()}`;
}

/** Form body for the batchexecute read-aloud RPC (the request gTTS sends). */
export function readAloudRpcBody(text: string, tl: string): string {
  const parameter = JSON.stringify([text, tl, null, 'null']);
  const rpc = JSON.stringify([[['jQ1olc', parameter, null, 'generic']]]);
  return `f.req=${encodeURIComponent(rpc)}&`;
}

/** Pull the base64 MP3 out of a batchexecute response; null when absent. */
export function readAloudRpcAudio(body: string): Uint8Array | null {
  const match = /jQ1olc","\[\\"(.*?)\\"\]/.exec(String(body || ''));
  if (!match) return null;
  const b64 = match[1]
    .replace(/\\\//g, '/')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002b/gi, '+');
  try {
    const bytes = base64ToBytes(b64);
    return bytes.byteLength >= 200 ? bytes : null;
  } catch {
    return null;
  }
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

async function readAloudViaGet(
  q: string,
  target: { tl: string; host: string },
  idx: number,
  total: number,
  deadline: number,
): Promise<Uint8Array | null> {
  const hosts = target.host === 'translate.google.com' ? [target.host] : [target.host, 'translate.google.com'];
  for (const host of hosts) {
    const left = timeLeft(deadline);
    if (left < 300) return null;
    try {
      const r = await fetch(readAloudUrl(host, target.tl, q, idx, total), {
        headers: {
          'User-Agent': READ_ALOUD_UA,
          Referer: `https://${host}/`,
          Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.5',
        },
        signal: AbortSignal.timeout(Math.min(left, READ_ALOUD_REQUEST_MS)),
      });
      if (!r.ok) continue;
      // A blocked request comes back as an HTML/captcha page: never "audio".
      if (!/^audio\//i.test(String(r.headers.get('content-type') || ''))) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength >= 200) return bytes;
    } catch {
      // next host / the RPC shape
    }
  }
  return null;
}

async function readAloudViaRpc(
  q: string,
  target: { tl: string; host: string },
  deadline: number,
): Promise<Uint8Array | null> {
  const pieces = splitForSpeech(q, READ_ALOUD_RPC_MAX);
  const out: Uint8Array[] = [];
  for (const piece of pieces) {
    const left = timeLeft(deadline);
    if (left < 300) return null;
    try {
      const r = await fetch(`https://${target.host}/_/TranslateWebserverUi/data/batchexecute`, {
        method: 'POST',
        headers: {
          'User-Agent': READ_ALOUD_UA,
          Referer: `https://${target.host}/`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        body: readAloudRpcBody(piece, target.tl),
        signal: AbortSignal.timeout(Math.min(left, READ_ALOUD_REQUEST_MS)),
      });
      if (!r.ok) return null;
      const audio = readAloudRpcAudio(await r.text());
      if (!audio) return null;
      out.push(audio);
    } catch {
      return null;
    }
  }
  return out.length ? concatBytes(out) : null;
}

/**
 * Keyless spoken audio (MP3) for `text`, or null. Pieces are fetched a few at
 * a time and joined in order; if any piece fails the whole answer falls back,
 * because a hole in the middle of a sentence is worse than the browser voice.
 */
export async function keylessSpeech(
  text: string,
  lang: string,
  deadline = Date.now() + 7_000,
): Promise<SpeechBytes | null> {
  const target = readAloudTarget(lang);
  if (!target) return null;
  const parts = splitForSpeech(text, READ_ALOUD_GET_MAX);
  if (!parts.length) return null;
  const audio: Array<Uint8Array | null> = new Array(parts.length).fill(null);
  let failed = false;
  let next = 0;
  const worker = async () => {
    while (!failed && next < parts.length) {
      const idx = next++;
      const piece =
        (await readAloudViaGet(parts[idx], target, idx, parts.length, deadline)) ||
        (failed ? null : await readAloudViaRpc(parts[idx], target, deadline));
      if (!piece) {
        failed = true;
        return;
      }
      audio[idx] = piece;
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_ALOUD_PARALLEL, parts.length) }, worker));
  if (failed || audio.some((a) => !a)) return null;
  const bytes = concatBytes(audio as Uint8Array[]);
  return bytes.byteLength >= 500 ? { bytes, mime: 'audio/mpeg' } : null;
}
