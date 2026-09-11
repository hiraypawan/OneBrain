import { NextRequest, NextResponse } from 'next/server';
import { mapSaavn, mapItunesPodcast, firstEnclosureUrl, mapInvidious, type MediaTrack } from '@/lib/media';

// Keyless media search: songs (Saavn), podcasts (iTunes + RSS), videos
// (Invidious rotation). Everything guarded — sources die often, so a dead
// source just contributes nothing instead of failing the request.
async function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };

async function searchSaavn(q: string): Promise<MediaTrack[]> {
  // Community JioSaavn API moves domains occasionally; try each.
  for (const host of ['https://saavn.dev', 'https://saavn.me']) {
    try {
      const r = await timedFetch(`${host}/api/search/songs?query=${encodeURIComponent(q)}&limit=5`, 9000, { headers: UA });
      if (!r.ok) continue;
      const j = await r.json();
      const tracks = mapSaavn(j?.data?.results || j?.data?.songs || []);
      if (tracks.length) return tracks;
    } catch {}
  }
  return [];
}

async function searchPodcasts(q: string): Promise<MediaTrack[]> {
  try {
    const r = await timedFetch(
      `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=3&term=${encodeURIComponent(q)}`,
      9000
    );
    if (!r.ok) return [];
    const j = await r.json();
    const out: MediaTrack[] = [];
    for (const c of (j?.results || []).slice(0, 2)) {
      if (!c?.feedUrl) continue;
      try {
        const f = await timedFetch(c.feedUrl, 9000, { headers: { ...UA, Accept: 'application/rss+xml' } });
        if (!f.ok) continue;
        const t = mapItunesPodcast(c, firstEnclosureUrl(await f.text()));
        if (t) out.push(t);
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

const INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
];

async function searchVideos(q: string): Promise<MediaTrack[]> {
  for (const base of INVIDIOUS) {
    try {
      const r = await timedFetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, 8000, { headers: UA });
      if (!r.ok) continue;
      const tracks = mapInvidious(await r.json());
      if (tracks.length) return tracks.slice(0, 5);
    } catch {}
  }
  return [];
}

export async function POST(req: NextRequest) {
  const { query, kinds } = await req.json();
  const q = String(query || '').slice(0, 120);
  if (!q) return NextResponse.json({ tracks: [] });
  const runSearch = async (term: string) => {
    const want = new Set<string>(kinds || ['song', 'podcast', 'video']);
    const jobs: Promise<MediaTrack[]>[] = [];
    if (want.has('song')) jobs.push(searchSaavn(term));
    if (want.has('podcast')) jobs.push(searchPodcasts(term));
    if (want.has('video')) jobs.push(searchVideos(term));
    return (await Promise.all(jobs)).flat().slice(0, 12);
  };
  let tracks = await runSearch(q);
  // Transliteration misspellings (saudebaji vs saudebazi): one retry with
  // j/z swapped when the first pass finds nothing.
  if (!tracks.length) {
    const hasJ = q.includes('j');
    const hasZ = q.includes('z');
    const variant = hasJ && !hasZ ? q.replace(/j/g, 'z') : !hasJ && hasZ ? q.replace(/z/g, 'j') : q;
    if (variant !== q) tracks = await runSearch(variant);
  }
  // Always-on fallback: plain YouTube search opens in one tap when every
  // free API is down or rate-limited (common with community instances).
  return NextResponse.json({
    tracks,
    query: q,
    youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  });
}
