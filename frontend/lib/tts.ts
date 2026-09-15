// Client side of spoken replies: fetch REAL audio bytes for a reply, cache
// them, and hand them to the one shared <audio> element so playback follows
// the device the user is actually on.
//
// The reason this file exists at all: `speechSynthesis` is not routable
// (setSinkId does not apply to it), is refused outright by iOS Safari without
// a fresh gesture, and on Android Chrome often has no voices installed. Real
// audio bytes play everywhere and obey the OS output selection — neckband,
// earbuds, desk speaker, phone speaker — with no choosing required.

export type SpeechSource = 'user-key' | 'community';

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
    return blob.size > 1000 ? blob : null;
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
  if (body.size < 1000) return null;
  const source: SpeechSource = r.headers.get('X-OneBrain-Tts') === 'user-key' ? 'user-key' : 'community';
  return { blob: body.type ? body : new Blob([body], { type }), source };
}

/**
 * Ask the server for spoken audio for `text`.
 *
 * Returns null — never throws — whenever audio is unavailable, so callers can
 * fall back to the browser voice. A cached blob is reused so repeated replies
 * (greetings, confirmations) are instant and cost nothing.
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

  try {
    const r = await fetch('/api/speech/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
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
