// Unified playable item from any free source. No keys anywhere.
//
// Playback is driven by `store/media.ts`, not by window events: an event
// channel is invisible to tests and to React, which is how the mini-player
// ended up orphaned and silently unreachable. Everything in this module is
// pure or fetch-only so it can be unit-tested in a plain node environment.
export type MediaKind = 'song' | 'podcast' | 'video';

export interface MediaTrack {
  kind: MediaKind;
  title: string;
  artist: string;
  image: string;
  url: string; // direct audio OR watch/embed target
  source: 'saavn' | 'itunes' | 'invidious';
  videoId?: string;
}

export interface MediaSearchResult {
  tracks: MediaTrack[];
  query: string;
  youtubeSearchUrl: string;
  /** Which endpoint answered, so failures can be reported honestly. */
  via: 'worker' | 'local' | 'none';
  /** Present only when nothing playable came back. Never invented. */
  failure?: string;
}

// Budget: community sources are slow and unreliable. Per-source timeout is
// short and the whole search is bounded, so a dead host costs seconds, not
// half a minute (the previous 9s x every host x retry path).
export const MEDIA_SOURCE_TIMEOUT_MS = 4500;
export const MEDIA_SEARCH_TIMEOUT_MS = 9000;

export function youtubeSearchUrlFor(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
}

// ---- Source mappers (pure, tested; network lives in the API route) ----

export function mapSaavn(songs: any[]): MediaTrack[] {
  const out: MediaTrack[] = [];
  for (const s of songs || []) {
    const dls = s?.downloadUrl || [];
    const best = dls[dls.length - 1]?.url || dls[0]?.url;
    if (!best) continue;
    const artists = Array.isArray(s?.artists?.primary)
      ? s.artists.primary.map((a: any) => a?.name).filter(Boolean).join(', ')
      : '';
    out.push({
      kind: 'song',
      title: String(s?.name || s?.title || 'Unknown song'),
      artist: artists,
      image: s?.image?.[1]?.url || s?.image?.[0]?.url || '',
      url: String(best),
      source: 'saavn',
    });
  }
  return out;
}

export function mapItunesPodcast(collection: any, episodeAudioUrl: string): MediaTrack | null {
  if (!episodeAudioUrl) return null;
  return {
    kind: 'podcast',
    title: String(collection?.trackName || collection?.collectionName || 'Podcast episode'),
    artist: String(collection?.artistName || ''),
    image: String(collection?.artworkUrl600 || collection?.artworkUrl100 || ''),
    url: episodeAudioUrl,
    source: 'itunes',
  };
}

// First <enclosure url="..."> in an RSS feed (regex avoids an XML dep).
export function firstEnclosureUrl(rss: string): string {
  const m = /<enclosure[^>]+url=["']([^"']+)["']/i.exec(String(rss || ''));
  return m ? m[1] : '';
}

export function mapInvidious(results: any[]): MediaTrack[] {
  const out: MediaTrack[] = [];
  for (const r of results || []) {
    const id = r?.videoId;
    if (!id || r?.type !== 'video') continue;
    out.push({
      kind: 'video',
      title: String(r?.title || 'Video'),
      artist: String(r?.author || ''),
      image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: youtubeEmbedUrl(id),
      source: 'invidious',
      videoId: id,
    });
  }
  return out;
}

export function pickFirstPlayable(tracks: MediaTrack[]): MediaTrack | null {
  return (tracks || []).find((t) => !!t.url) || null;
}

/** Index of the next track after `from` that can actually be played, else -1. */
export function nextPlayableIndex(tracks: MediaTrack[], from: number): number {
  const list = tracks || [];
  for (let i = from + 1; i < list.length; i++) if (list[i]?.url) return i;
  return -1;
}

/** Plain-language names: "saavn" means nothing to a person mid-commute. */
export function mediaSourceLabel(source: MediaTrack['source'] | string): string {
  if (source === 'saavn') return 'JioSaavn (free community API)';
  if (source === 'itunes') return 'Podcast feed (Apple directory)';
  if (source === 'invidious') return 'YouTube (via a public Invidious instance)';
  return 'Unknown source';
}

/**
 * HTMLMediaElement error codes -> an honest sentence. A stalled stream and a
 * region-blocked one look identical in the DOM, so we say what we know and
 * never claim the song is playing.
 */
export function describeMediaError(code?: number): string {
  switch (code) {
    case 1:
      return 'Playback was aborted before it started. The stream link expired or the request was cancelled.';
    case 2:
      return 'The stream stopped mid-play. This free source dropped the connection.';
    case 3:
      return 'That file could not be decoded by this browser.';
    case 4:
      return 'The source refused the stream (offline, region-blocked or rate-limited).';
    default:
      return 'This free source did not serve the audio.';
  }
}

export const AUTOPLAY_BLOCKED_NOTICE =
  'Your browser blocked automatic playback. Tap play once — after that this session can start songs by itself.';

/**
 * Search for playable media. Tries the deployed API worker first (it works on
 * any hosting target), then this app's own route, which additionally retries
 * j/z transliteration spellings. Never throws: a dead source contributes
 * nothing and the caller always gets a YouTube hand-off URL.
 */
export async function searchMedia(
  query: string,
  kinds?: MediaKind[],
  opts: { fetchImpl?: typeof fetch; apiBase?: string; timeoutMs?: number } = {},
): Promise<MediaSearchResult> {
  const q = String(query || '').trim().slice(0, 120);
  const doFetch = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? MEDIA_SEARCH_TIMEOUT_MS;
  const youtubeSearchUrl = youtubeSearchUrlFor(q);
  const empty: MediaSearchResult = { tracks: [], query: q, youtubeSearchUrl, via: 'none' };
  if (!q) return { ...empty, failure: 'Say what to play, for example “play kesariya”.' };

  const bases: { via: 'worker' | 'local'; url: string }[] = [];
  const apiBase = (opts.apiBase ?? '').replace(/\/$/, '');
  if (apiBase) bases.push({ via: 'worker', url: `${apiBase}/api/media` });
  bases.push({ via: 'local', url: '/api/media' });

  const problems: string[] = [];
  for (const target of bases) {
    try {
      const response = await doFetch(target.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, kinds }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        problems.push(`${target.via === 'worker' ? 'cloud' : 'local'} search replied ${response.status}`);
        continue;
      }
      const json: any = await response.json();
      const tracks: MediaTrack[] = Array.isArray(json?.tracks) ? json.tracks.filter((t: any) => t && t.url) : [];
      if (tracks.length) {
        return {
          tracks,
          query: q,
          youtubeSearchUrl: String(json?.youtubeSearchUrl || youtubeSearchUrl),
          via: target.via,
        };
      }
      problems.push('no free source returned a playable link');
    } catch (error: any) {
      const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      problems.push(aborted ? 'search timed out' : 'search could not reach the network');
    }
  }
  return { ...empty, youtubeSearchUrl, failure: problems.join('; ') || undefined };
}
