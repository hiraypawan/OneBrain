// Server-side text-to-speech providers for OneBrain replies.
// Real spoken audio for OneBrain replies.
//
// Why this exists: browser speechSynthesis is the only thing this app used to
// rely on, and it is the least reliable audio path on the platforms people
// actually use. It cannot be routed to a chosen speaker (setSinkId does not
// apply to it), iOS Safari refuses to start it without a fresh user gesture,
// Android Chrome frequently reports zero voices, and several engines swallow
// utterances with no error event at all. Result: text-only replies.
//
// Audio BYTES play through an <audio> element instead, which every platform
// supports, follows the OS output automatically (neckband / earbuds / speaker),
// can be pinned with setSinkId on Chromium, and shows up in the lock screen.
//
// Hosting cost stays at zero: HOST provider keys are never read here. Ordered:
//   1. the user's own AI key (their quota, their plan) — best quality, Indian
//      languages included;
//   2. a keyless community audio model, so zero-setup users still get sound;
//   3. `{ fallback: true }` — the client then uses the browser voice.
//
// The client always has a working fallback, so a provider outage degrades to
// the previous behaviour instead of silence.

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

// Community audio model voices (OpenAI-compatible names).
export function communityVoiceFor(lang: string): string {
  const base = String(lang || '').toLowerCase().split('-')[0];
  const indian = ['hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'ur'];
  return indian.includes(base) ? 'alloy' : 'nova';
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

/**
 * Speech built on the CALLER's own key. Their plan, their quota — the host
 * never spends anything. Returns null on any failure so the next tier runs.
 */
export async function userKeySpeech(
  text: string,
  lang: string,
  userKey: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  for (const model of GEMINI_TTS_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': userKey },
          signal: AbortSignal.timeout(20_000),
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

/**
 * Keyless community audio (the same family of keyless providers this app
 * already uses for chat). Zero setup for the user, no host key involved.
 */
export async function communitySpeech(
  text: string,
  lang: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const voice = communityVoiceFor(lang);
  // Two shapes of the same keyless service: the plain GET returns audio bytes,
  // the OpenAI-compatible POST returns base64 audio inside JSON. Trying both
  // means one provider outage does not take spoken replies down with it.
  try {
    const url = `https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=${encodeURIComponent(voice)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (r.ok) {
      const type = String(r.headers.get('content-type') || '');
      if (/^audio\//i.test(type)) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.byteLength >= 1000)
          return { bytes, mime: /mp3|mpeg/i.test(type) ? 'audio/mpeg' : type.split(';')[0] };
      }
    }
  } catch {
    // fall through to the JSON shape
  }
  try {
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: 'openai-audio',
        modalities: ['text', 'audio'],
        audio: { voice, format: 'mp3' },
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const b64 = j?.choices?.[0]?.message?.audio?.data || j?.audio?.data || j?.data;
    if (typeof b64 !== 'string' || !b64) return null;
    const bytes = base64ToBytes(b64);
    if (bytes.byteLength < 1000) return null;
    return { bytes, mime: 'audio/mpeg' };
  } catch {
    return null;
  }
}
