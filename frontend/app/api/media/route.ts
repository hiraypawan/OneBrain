import { NextRequest, NextResponse } from 'next/server';
import {
  firstEnclosureUrl,
  mapInvidious,
  mapItunesPodcast,
  mapSaavn,
  MEDIA_SOURCE_TIMEOUT_MS,
  youtubeSearchUrlFor,
  type MediaTrack,
} from '@/lib/media';

// Keyless media search: songs (Saavn), podcasts (iTunes + RSS), videos
// (Invidious rotation). Everything guarded — sources die often, so a dead
// source contributes nothing instead of failing the request, and the caller
// always receives a YouTube hand-off URL.
//
// Bounded on purpose. The previous version could spend 9s per host across
// every host plus a transliteration retry (~30s worst case). Now: a short
// per-source timeout, an isolate-level cooldown for hosts that just failed, a
// small in-memory result cache, and a hard total budget.

const TOTAL_BUDGET_MS = 9000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_ENTRIES = 60;
const COOLDOWN_MS = 60_000;

const SAANN_HOSTS = ['https://saavn.dev', 'https://saavn.me'];
const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };

/** Isolate-local only: a hint, never a promise, and never shared state. */
const failures = new Map<string, number>();
const cache = new Map<string, { at: number; value: any }>();

function onCooldown(host: string, now: number): boolean {
  const until = failures.get(host) || 0;
  if (until > now) return true;
  failures.delete(host);
  return false;
}

function noteFailure(host: string, now: number) {
  failures.set(host, now + COOLDOWN_MS);
}

async function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function searchSaavn(q: string, budget: number): Promise<MediaTrack[]> {
  const now = Date.now();
  for (const host of SAANN_HOSTS) {
    if (onCooldown(host, now) || budget <= 0) continue;
    try {
      const r = await timedFetch(
        `${host}/api/search/songs?query=${encodeURIComponent(q)}&limit=5`,
        Math.min(MEDIA_SOURCE_TIMEOUT_MS, budget),
        { headers: UA },
      );
      if (!r.ok) {
        noteFailure(host, Date.now());
        continue;
      }
      const j = await r.json();
      const tracks = mapSaavn(j?.data?.results || j?.data?.songs || []);
      if (tracks.length) return tracks;
    } catch {
      noteFailure(host, Date.now());
    }
  }
  return [];
}

async function searchPodcasts(q: string, budget: number): Promise<MediaTrack[]> {
  const host = 'https://itunes.apple.com';
  const now = Date.now();
  if (onCooldown(host, now) || budget <= 0) return [];
  try {
    const r = await timedFetch(
      `${host}/search?media=podcast&entity=podcast&limit=3&term=${encodeURIComponent(q)}`,
      Math.min(MEDIA_SOURCE_TIMEOUT_MS, budget),
      { headers: UA },
    );
    if (!r.ok) {
      noteFailure(host, Date.now());
      return [];
    }
    const j = await r.json();
    const out: MediaTrack[] = [];
    for (const c of (j?.results || []).slice(0, 2)) {
      if (!c?.feedUrl) continue;
      try {
        const f = await timedFetch(c.feedUrl, Math.min(MEDIA_SOURCE_TIMEOUT_MS, budget), {
          headers: { ...UA, Accept: 'application/rss+xml' },
        });
        if (!f.ok) continue;
        const t = mapItunesPodcast(c, firstEnclosureUrl(await f.text()));
        if (t) out.push(t);
      } catch {}
    }
    return out;
  } catch {
    noteFailure(host, Date.now());
    return [];
  }
}

async function searchVideos(q: string, budget: number): Promise<MediaTrack[]> {
  const now = Date.now();
  for (const base of INVIDIOUS) {
    if (onCooldown(base, now) || budget <= 0) continue;
    try {
      const r = await timedFetch(
        `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
        Math.min(MEDIA_SOURCE_TIMEOUT_MS, budget),
        { headers: UA },
      );
      if (!r.ok) {
        noteFailure(base, Date.now());
        continue;
      }
      const tracks = mapInvidious(await r.json());
      if (tracks.length) return tracks.slice(0, 5);
    } catch {
      noteFailure(base, Date.now());
    }
  }
  return [];
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400 });
  }
  const q = String(body?.query || '').trim().slice(0, 120);
  if (!q) return NextResponse.json({ tracks: [], query: '', youtubeSearchUrl: '' });
  const kinds = Array.isArray(body?.kinds) ? body.kinds : undefined;

  const cacheKey = `${q.toLowerCase()}|${(kinds || []).join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({ ...cached.value, cached: true });
  }

  const startedAt = Date.now();
  const remaining = () => Math.max(0, TOTAL_BUDGET_MS - (Date.now() - startedAt));
  const runSearch = async (term: string) => {
    const want = new Set<string>(kinds || ['song', 'podcast', 'video']);
    const jobs: Promise<MediaTrack[]>[] = [];
    if (want.has('song')) jobs.push(searchSaavn(term, remaining()));
    if (want.has('podcast')) jobs.push(searchPodcasts(term, remaining()));
    if (want.has('video')) jobs.push(searchVideos(term, remaining()));
    return (await Promise.all(jobs)).flat().slice(0, 12);
  };

  let tracks = await runSearch(q);
  // Transliteration misspellings (saudebaji vs saudebazi): one retry with
  // j/z swapped when the first pass finds nothing and budget remains.
  if (!tracks.length && remaining() > 1500) {
    const hasJ = q.includes('j');
    const hasZ = q.includes('z');
    const variant = hasJ && !hasZ ? q.replace(/j/g, 'z') : !hasJ && hasZ ? q.replace(/z/g, 'j') : q;
    if (variant !== q) tracks = await runSearch(variant);
  }

  const value = {
    tracks,
    query: q,
    youtubeSearchUrl: youtubeSearchUrlFor(q),
    // Tells the client what actually answered, so it can be honest about a
    // busy source instead of implying a healthy catalog.
    sources: {
      tried: (kinds || ['song', 'podcast', 'video']).length,
      playable: tracks.length,
      coolingDown: failures.size,
      elapsedMs: Date.now() - startedAt,
    },
  };
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return NextResponse.json(value);
}
