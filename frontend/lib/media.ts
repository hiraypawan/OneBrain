// Unified playable item from any free source. No keys anywhere.
export interface MediaTrack {
  kind: 'song' | 'podcast' | 'video';
  title: string;
  artist: string;
  image: string;
  url: string; // direct audio OR watch/embed target
  source: 'saavn' | 'itunes' | 'invidious';
  videoId?: string;
}

export const MEDIA_PLAY_EVENT = 'onebrain-media-play';
export const MEDIA_CONTROL_EVENT = 'onebrain-media-control';
export type MediaControl = 'pause' | 'resume' | 'close';

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
