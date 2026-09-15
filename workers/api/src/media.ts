// Keyless media search for the Workers runtime: songs (community JioSaavn
// API), podcasts (Apple directory + RSS enclosure), videos (public Invidious
// instances). Mirrors frontend/app/api/media/route.ts, which serves the same
// shape for local/Next hosting; the constants below are deliberately equal so
// the two runtimes behave the same.
//
// Nothing here promises playback. Every source is guarded, the whole search is
// bounded, failed hosts cool down for a minute inside this isolate, and the
// response always carries a YouTube search hand-off.

export interface MediaTrack {
  kind: 'song' | 'podcast' | 'video';
  title: string;
  artist: string;
  image: string;
  url: string;
  source: 'saavn' | 'itunes' | 'invidious';
  videoId?: string;
}

const SOURCE_TIMEOUT_MS = 4500;
const TOTAL_BUDGET_MS = 9000;
const COOLDOWN_MS = 60_000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 60;
const MEDIA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const SAAVN_HOSTS = ['https://saavn.dev', 'https://saavn.me'];
const INVIDIOUS_HOSTS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
];
const ITUNES_HOST = 'https://itunes.apple.com';

/** Isolate-local hints. Never shared state, never a guarantee. */
const cooldowns = new Map<string, number>();
const cache = new Map<string, { at: number; value: MediaSearchResponse }>();

export interface MediaSearchResponse {
  tracks: MediaTrack[];
  query: string;
  youtubeSearchUrl: string;
  sources?: { tried: number; playable: number; coolingDown: number; elapsedMs: number };
  cached?: boolean;
}

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function coolingDown(host: string, now: number): boolean {
  const until = cooldowns.get(host) || 0;
  if (until > now) return true;
  cooldowns.delete(host);
  return false;
}

function noteFailure(host: string, now: number) {
  cooldowns.set(host, now + COOLDOWN_MS);
}

async function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(250, ms));
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapSaavn(songs: any[]): MediaTrack[] {
  const out: MediaTrack[] = [];
  for (const s of songs || []) {
    const dls = s?.downloadUrl || [];
    const best = dls[dls.length - 1]?.url || dls[0]?.url;
    if (!best) continue;
    out.push({
      kind: 'song',
      title: String(s?.name || s?.title || 'Unknown song'),
      artist: Array.isArray(s?.artists?.primary)
        ? s.artists.primary.map((a: any) => a?.name).filter(Boolean).join(', ')
        : '',
      image: s?.image?.[1]?.url || s?.image?.[0]?.url || '',
      url: String(best),
      source: 'saavn',
    });
  }
  return out;
}

function mapInvidious(results: any[]): MediaTrack[] {
  const out: MediaTrack[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    const id = r?.videoId;
    if (!id || r?.type !== 'video') continue;
    out.push({
      kind: 'video',
      title: String(r.title || 'Video'),
      artist: String(r.author || ''),
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      source: 'invidious',
      videoId: id,
    });
  }
  return out;
}

async function searchSongs(term: string, budget: number): Promise<MediaTrack[]> {
  const now = Date.now();
  for (const host of SAAVN_HOSTS) {
    if (coolingDown(host, now) || budget <= 0) continue;
    try {
      const r = await timedFetch(
        `${host}/api/search/songs?query=${encodeURIComponent(term)}&limit=5`,
        Math.min(SOURCE_TIMEOUT_MS, budget),
        { headers: { 'User-Agent': MEDIA_UA } },
      );
      if (!r.ok) {
        noteFailure(host, Date.now());
        continue;
      }
      const j: any = await r.json();
      const tracks = mapSaavn(j?.data?.results || j?.data?.songs || []);
      if (tracks.length) return tracks;
    } catch {
      noteFailure(host, Date.now());
    }
  }
  return [];
}

async function searchPodcasts(term: string, budget: number): Promise<MediaTrack[]> {
  const now = Date.now();
  if (coolingDown(ITUNES_HOST, now) || budget <= 0) return [];
  try {
    const r = await timedFetch(
      `${ITUNES_HOST}/search?media=podcast&entity=podcast&limit=3&term=${encodeURIComponent(term)}`,
      Math.min(SOURCE_TIMEOUT_MS, budget),
      { headers: { 'User-Agent': MEDIA_UA } },
    );
    if (!r.ok) {
      noteFailure(ITUNES_HOST, Date.now());
      return [];
    }
    const j: any = await r.json();
    const out: MediaTrack[] = [];
    for (const col of (j?.results || []).slice(0, 2)) {
      if (!col?.feedUrl) continue;
      try {
        const feed = await timedFetch(col.feedUrl, Math.min(SOURCE_TIMEOUT_MS, budget), {
          headers: { 'User-Agent': MEDIA_UA },
        });
        if (!feed.ok) continue;
        const m = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(await feed.text());
        if (m?.[1]) {
          out.push({
            kind: 'podcast',
            title: String(col?.trackName || col?.collectionName || 'Podcast episode'),
            artist: String(col?.artistName || ''),
            image: String(col?.artworkUrl600 || col?.artworkUrl100 || ''),
            url: m[1],
            source: 'itunes',
          });
        }
      } catch {
        /* One dead feed must not remove the other. */
      }
    }
    return out;
  } catch {
    noteFailure(ITUNES_HOST, Date.now());
    return [];
  }
}

async function searchVideos(term: string, budget: number): Promise<MediaTrack[]> {
  const now = Date.now();
  for (const host of INVIDIOUS_HOSTS) {
    if (coolingDown(host, now) || budget <= 0) continue;
    try {
      const r = await timedFetch(
        `${host}/api/v1/search?q=${encodeURIComponent(term)}&type=video`,
        Math.min(SOURCE_TIMEOUT_MS, budget),
        { headers: { 'User-Agent': MEDIA_UA } },
      );
      if (!r.ok) {
        noteFailure(host, Date.now());
        continue;
      }
      const tracks = mapInvidious(await r.json());
      if (tracks.length) return tracks.slice(0, 5);
    } catch {
      noteFailure(host, Date.now());
    }
  }
  return [];
}

/** One bounded search. Never throws; an empty result is an honest result. */
export async function searchMedia(query: string, kinds?: unknown): Promise<MediaSearchResponse> {
  const q = String(query || '').trim().slice(0, 120);
  if (!q) return { tracks: [], query: '', youtubeSearchUrl: '' };
  const want = new Set<string>(
    Array.isArray(kinds) ? kinds.filter((k) => typeof k === 'string') : ['song', 'podcast', 'video'],
  );

  const cacheKey = `${q.toLowerCase()}|${[...want].sort().join(',')}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  const startedAt = Date.now();
  const remaining = () => Math.max(0, TOTAL_BUDGET_MS - (Date.now() - startedAt));
  const run = async (term: string) => {
    const jobs: Promise<MediaTrack[]>[] = [];
    if (want.has('song')) jobs.push(searchSongs(term, remaining()));
    if (want.has('podcast')) jobs.push(searchPodcasts(term, remaining()));
    if (want.has('video')) jobs.push(searchVideos(term, remaining()));
    return (await Promise.all(jobs)).flat().slice(0, 12);
  };

  let tracks = await run(q);
  // Transliteration retry (saudebaji vs saudebazi) only while budget remains.
  if (!tracks.length && remaining() > 1500) {
    const hasJ = q.includes('j');
    const hasZ = q.includes('z');
    const variant = hasJ && !hasZ ? q.replace(/j/g, 'z') : !hasJ && hasZ ? q.replace(/z/g, 'j') : q;
    if (variant !== q) tracks = await run(variant);
  }

  const value: MediaSearchResponse = {
    tracks,
    query: q,
    youtubeSearchUrl: youtubeSearchUrl(q),
    sources: { tried: want.size, playable: tracks.length, coolingDown: cooldowns.size, elapsedMs: Date.now() - startedAt },
  };
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Test/diagnostic hook: drop isolate-local hints. */
export function resetMediaHints() {
  cooldowns.clear();
  cache.clear();
}
