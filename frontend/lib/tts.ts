// Client side of spoken replies: fetch REAL audio bytes for a reply, cache
// them, and hand them to the one shared <audio> element so playback follows
// the device the user is actually on.
//
// The reason this file exists at all: `speechSynthesis` is not routable
// (setSinkId does not apply to it), is refused outright by iOS Safari without
// a fresh gesture, and on Android Chrome often has no voices installed. Real
// audio bytes play everywhere and obey the OS output selection — neckband,
// earbuds, desk speaker, phone speaker — with no choosing required.

export type SpeechSource = 'user-key' | 'community' | 'puter';

export interface SpeechAudio {
  blob: Blob;
  source: SpeechSource;
}

export interface SpeechRequest {
  text: string;
  lang?: string;
  apiKey?: string;
}

const CACHE_NAME = 'onebrain-speech-v1';

/** Stable key for "this text, in this language". */
export function speechCacheKey(text: string, lang = ''): string {
  const t = String(text || '').trim();
  // djb2 over the text keeps keys short and stable without crypto.subtle.
  let h = 5381;
  for (let i = 0; i < t.length; i += 1) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return `${lang || 'x'}-${t.length}-${h.toString(36)}`;
}

function cacheUrl(key: string): string {
  return `/__onebrain-speech/${encodeURIComponent(key)}`;
}

function cacheStore(): Promise<Cache> | null {
  try {
    if (typeof caches === 'undefined') return null;
    return caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** Previously synthesized audio for the same text+language, if any. */
export async function readCachedSpeech(key: string): Promise<Blob | null> {
  const store = cacheStore();
  if (!store) return null;
  try {
    const hit = await (await store).match(cacheUrl(key));
    if (!hit) return null;
    const blob = await hit.blob();
    return blob.size > 500 ? blob : null;
  } catch {
    return null;
  }
}

export async function cacheSpeech(key: string, blob: Blob): Promise<void> {
  const store = cacheStore();
  if (!store) return;
  try {
    await (await store).put(
      cacheUrl(key),
      new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }),
    );
  } catch {
    // Cache Storage is best-effort (private mode, quota, older browsers).
  }
}

export function dropCachedSpeech(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return Promise.resolve();
    return caches.delete(CACHE_NAME).then(() => {});
  } catch {
    return Promise.resolve();
  }
}

function audioBlobFrom(r: Response, body: Blob): SpeechAudio | null {
  const type = String(r.headers.get('Content-Type') || body.type || '').toLowerCase();
  if (!type.startsWith('audio/')) return null;
  if (body.size < 500) return null;
  const source: SpeechSource = r.headers.get('X-OneBrain-Tts') === 'user-key' ? 'user-key' : 'community';
  return { blob: body.type ? body : new Blob([body], { type }), source };
}

/**
 * Keyless client speech via Puter.js (loaded in browser).
 * Free, zero setup, and requires no API keys or login.
 */
export async function synthesizeWithPuter(
  text: string,
  lang?: string,
  timeoutMs = 10_000,
): Promise<SpeechAudio | null> {
  if (typeof window === 'undefined') return null;
  const puter = (window as any).puter;
  if (!puter?.ai?.txt2speech) return null;
  try {
    const task = (async (): Promise<Blob | null> => {
      const opts: Record<string, string> = {};
      if (lang) opts.language = lang;
      const res = await puter.ai.txt2speech(text, Object.keys(opts).length ? opts : undefined);
      if (!res) return null;
      const src = typeof res === 'string' ? res : res.src;
      if (!src) return null;
      const r = await fetch(src);
      if (!r.ok) return null;
      const blob = await r.blob();
      return blob.size >= 500 ? blob : null;
    })();

    const blob = await Promise.race([
      task,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (!blob) return null;
    return { blob, source: 'puter' };
  } catch {
    return null;
  }
}

/**
 * Ask for spoken audio for `text`.
 *
 * Ordered:
 * 1. Cache hit (instant, 0 network).
 * 2. Caller's own API key (if provided) via `/api/speech/tts`.
 * 3. Free client Puter.js TTS (`puter.ai.txt2speech`).
 * 4. Server `/api/speech/tts` keyless community voice.
 *
 * Returns null — never throws — whenever audio is unavailable, so callers can
 * fall back to the browser voice.
 */
export async function synthesizeSpeech(
  req: SpeechRequest,
  opts: { timeoutMs?: number } = {},
): Promise<SpeechAudio | null> {
  const text = String(req.text || '').trim();
  if (!text) return null;
  const lang = req.lang || '';
  const key = speechCacheKey(text, lang);

  const cached = await readCachedSpeech(key);
  if (cached) return { blob: cached, source: 'community' };

  // 1. Caller's own key: user's quota, custom models
  if (req.apiKey) {
    try {
      const r = await fetch('/api/speech/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        body: JSON.stringify({ text, lang, userKey: req.apiKey }),
      });
      if (r.ok) {
        const body = await r.blob();
        const audio = audioBlobFrom(r, body);
        if (audio) {
          void cacheSpeech(key, audio.blob);
          return audio;
        }
      }
    } catch {}
  }

  // 2. Free, keyless client Puter.js TTS
  const puterAudio = await synthesizeWithPuter(text, lang, opts.timeoutMs ?? 10_000);
  if (puterAudio) {
    void cacheSpeech(key, puterAudio.blob);
    return puterAudio;
  }

  // 3. Server fallback route (community audio)
  try {
    const r = await fetch('/api/speech/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
      body: JSON.stringify({ text, lang, userKey: req.apiKey || undefined }),
    });
    if (!r.ok) return null;
    const body = await r.blob();
    const audio = audioBlobFrom(r, body);
    if (!audio) return null;
    void cacheSpeech(key, audio.blob);
    return audio;
  } catch {
    return null;
  }
}
