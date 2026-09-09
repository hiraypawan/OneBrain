'use client';
import { useEffect, useRef, useState } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { useAssistant } from '@/hooks/useAssistant';
import {
  MEDIA_PLAY_EVENT,
  MEDIA_CONTROL_EVENT,
  pickFirstPlayable,
  type MediaTrack,
  type MediaControl,
} from '@/lib/media';

// Sticky mini-player: songs/podcasts via <audio>, videos via nocookie embed.
// Driven by voice ("play kesariya") through window events so the mic hook
// (which owns the transcript) never touches DOM playback directly.
export function MediaPlayer() {
  const [track, setTrack] = useState<MediaTrack | null>(null);
  const [list, setList] = useState<MediaTrack[]>([]);
  const [ytUrl, setYtUrl] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { speak } = useAssistant();
  const speakRef = useRef(speak);
  speakRef.current = speak;

  const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

  useEffect(() => {
    const searchTracks = async (query: string, kinds?: string[]) => {
      // Cloud worker first (runs anywhere, incl. static export), then the
      // local Next route, which additionally retries j/z spellings.
      const payload = { query, kinds };
      if (API_BASE) {
        try {
          const r = await fetch(`${API_BASE}/api/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            const j = await r.json();
            if (j.tracks?.length) return j;
          }
        } catch {}
      }
      const r = await fetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return r.json();
    };

    const playQuery = async (query: string, kinds?: string[]) => {
      const st = useAssistantStore.getState();
      st.setCurrentStatus('processing');
      setSearching(true);
      setTrack(null);
      try {
        const j = await searchTracks(query, kinds);
        const tracks: MediaTrack[] = j.tracks || [];
        setList(tracks);
        setYtUrl(j.youtubeSearchUrl || '');
        const first = pickFirstPlayable(tracks);
        if (!first) {
          const msg = `Kuch nahi mila "${query}" ke liye. Spelling badal kar try karo.`;
          st.addMessage('assistant', msg);
          await speakRef.current(msg);
          if (useAssistantStore.getState().isActive) st.setCurrentStatus('listening');
          return;
        }
        setTrack(first);
        st.addMessage('assistant', `Playing: ${first.title}${first.artist ? ` — ${first.artist}` : ''}`);
        if (useAssistantStore.getState().isActive) st.setCurrentStatus('listening');
      } catch {
        const msg = 'Music search fail ho gaya. Dobara try karo.';
        st.addMessage('assistant', msg);
        await speakRef.current(msg);
      } finally {
        setSearching(false);
      }
    };

    const onControl = (e: Event) => {
      const action = (e as CustomEvent<MediaControl>).detail;
      if (action === 'pause') audioRef.current?.pause();
      else if (action === 'resume') audioRef.current?.play().catch(() => {});
      else if (action === 'close') close();
    };
    const onPlay = async (e: Event) => {
      const detail = (e as CustomEvent<any>).detail || {};
      const q = typeof detail === 'string' ? detail : detail.query || '';
      const kinds = Array.isArray(detail?.kinds) ? detail.kinds : undefined;
      setQuery(q);
      await playQuery(q, kinds);
    };
    window.addEventListener(MEDIA_CONTROL_EVENT, onControl);
    window.addEventListener(MEDIA_PLAY_EVENT, onPlay);
    return () => {
      window.removeEventListener(MEDIA_CONTROL_EVENT, onControl);
      window.removeEventListener(MEDIA_PLAY_EVENT, onPlay);
    };
  }, []);

  // Route cloud-audio playback to the chosen speaker, when supported.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track || track.kind === 'video') return;
    try {
      const sink = useAssistantStore.getState().speakerDeviceId;
      if (sink && typeof (el as any).setSinkId === 'function') {
        (el as any).setSinkId(sink).catch(() => {});
      }
    } catch {}
  }, [track]);

  if (!track && !searching && list.length === 0) return null;

  const pick = (t: MediaTrack) => {
    if (t.kind !== 'video') audioRef.current?.pause();
    setTrack(t);
    setPlaying(true);
  };

  const close = () => {
    audioRef.current?.pause();
    setTrack(null);
    setList([]);
    setYtUrl('');
    setPlaying(false);
  };

  return (
    <div className="fixed bottom-[76px] md:bottom-4 left-2 right-2 md:left-auto md:right-4 md:w-80 z-20 bg-gray-900 border border-gray-700 rounded-xl p-2 shadow-2xl">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-bold truncate">
          {searching ? '🔎 Searching…' : track ? `▶ ${track.title}` : '🎵 Results'}
        </div>
        <button onClick={close} className="text-gray-400 px-2">✕</button>
      </div>
      {track && track.kind !== 'video' && (
        <audio
          ref={audioRef}
          src={track.url}
          autoPlay
          controls
          className="w-full mt-1"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      )}
      {track && track.kind === 'video' && (
        <iframe
          key={track.url}
          src={track.url}
          title={track.title}
          className="w-full h-40 mt-1 rounded"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      )}
      {!track && !searching && list.length === 0 && ytUrl && (
        <a href={ytUrl} target="_blank" rel="noreferrer" className="block mt-1 text-xs text-blue-400 underline px-1">
          Free sources are busy - search YouTube for {query || 'this'} instead
        </a>
      )}
      {list.length > 1 && (
        <div className="mt-1 max-h-28 overflow-auto text-xs space-y-1">
          {list.map((t, i) => (
            <button
              key={`${t.source}-${i}`}
              onClick={() => pick(t)}
              className={`block w-full text-left px-2 py-1 rounded truncate ${t.url === track?.url ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
            >
              {t.kind === 'song' ? '🎵' : t.kind === 'podcast' ? '🎙️' : '📺'} {t.title}
              {t.artist ? ` — ${t.artist}` : ''} · {playing && t.url === track?.url ? 'playing' : t.source}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
