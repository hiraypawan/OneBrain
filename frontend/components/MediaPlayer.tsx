'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaStore } from '@/store/media';
import { useAssistantStore } from '@/store/assistant';
import { activeSinkId, SPEECH_DUCK_EVENT } from '@/lib/audio';
import { mediaSourceLabel, type MediaKind, type MediaTrack } from '@/lib/media';
import { Icon } from './ui/Icon';

const KIND_LABELS: { id: MediaKind; label: string }[] = [
  { id: 'song', label: 'Songs' },
  { id: 'podcast', label: 'Podcasts' },
  { id: 'video', label: 'Videos' },
];

/**
 * Sticky mini-player: songs/podcasts through <audio>, videos through a
 * nocookie embed. All state lives in `store/media.ts`, so voice ("play
 * kesariya"), the typed search here and Your space → Music drive one player.
 *
 * Two rules this component follows, both learned the hard way:
 *  1. Never fail quietly. Autoplay blocks, refused streams and dead sources
 *     all produce a visible notice and, where possible, a spoken one.
 *  2. No stale closures over functions declared after an early return — that
 *     silently broke "stop song" (a TDZ ReferenceError inside the listener).
 */
export function MediaPlayer() {
  const current = useMediaStore((s) => s.current);
  const list = useMediaStore((s) => s.list);
  const status = useMediaStore((s) => s.status);
  const notice = useMediaStore((s) => s.notice);
  const query = useMediaStore((s) => s.query);
  const youtubeSearchUrl = useMediaStore((s) => s.youtubeSearchUrl);
  const expanded = useMediaStore((s) => s.expanded);
  const setExpanded = useMediaStore((s) => s.setExpanded);
  const setPlayerMounted = useMediaStore((s) => s.setPlayerMounted);
  const request = useMediaStore((s) => s.request);
  const select = useMediaStore((s) => s.select);
  const control = useMediaStore((s) => s.control);
  const reportPlayback = useMediaStore((s) => s.reportPlayback);
  const refuseCurrent = useMediaStore((s) => s.refuseCurrent);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const duckedRef = useRef(false);
  const [buffering, setBuffering] = useState(false);
  const [term, setTerm] = useState('');
  const [kinds, setKinds] = useState<MediaKind[]>(['song']);

  // Tell the store this player exists. Without it a voice "play …" would be
  // dispatched into nothing — the exact silent failure this replaces.
  useEffect(() => {
    setPlayerMounted(true);
    return () => setPlayerMounted(false);
  }, [setPlayerMounted]);

  const publishMetadata = useCallback((track: MediaTrack | null) => {
    try {
      const ms: any = typeof navigator === 'undefined' ? undefined : (navigator as any).mediaSession;
      if (!ms) return;
      if (!track) {
        ms.playbackState = 'none';
        return;
      }
      const MM: any = typeof window === 'undefined' ? undefined : (window as any).MediaMetadata;
      if (MM) {
        ms.metadata = new MM({
          title: track.title,
          artist: track.artist || mediaSourceLabel(track.source),
          album: 'OneBrain player',
          artwork: track.image ? [{ src: track.image, sizes: '480x480', type: 'image/jpeg' }] : [],
        });
      }
      ms.playbackState = 'playing';
    } catch {
      /* Lock-screen metadata is a bonus, never a requirement. */
    }
  }, []);

  // Start playback explicitly so a blocked autoplay is reported instead of
  // leaving a player stuck at 0:00 with native controls and no explanation.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current || current.kind === 'video') return;
    setBuffering(false);
    try {
      el.load();
    } catch {}
    const sink = activeSinkId(useAssistantStore.getState().speakerDeviceId);
    if (sink && typeof (el as any).setSinkId === 'function') {
      try {
        const pinned = (el as any).setSinkId(sink);
        if (pinned?.catch) pinned.catch(() => reportPlayback(status === 'playing' ? 'playing' : 'paused', 'Could not pin this song to your chosen speaker; using the system output.'));
      } catch {}
    }
    let cancelled = false;
    const started = el.play();
    if (started && typeof started.then === 'function') {
      started
        .then(() => {
          if (!cancelled) publishMetadata(current);
        })
        .catch(() => {
          if (!cancelled) reportPlayback('blocked');
        });
    }
    return () => {
      cancelled = true;
    };
    // `status` is intentionally excluded: this effect is about the loaded track.
  }, [current, publishMetadata, reportPlayback]);

  // Spoken replies own the speaker: duck music, then restore it.
  useEffect(() => {
    const onDuck = (event: Event) => {
      const state = (event as CustomEvent<{ state: 'start' | 'end' }>).detail?.state;
      const el = audioRef.current;
      if (state === 'start') {
        if (!el || el.paused) return;
        duckedRef.current = true;
        try {
          el.pause();
        } catch {}
        return;
      }
      if (state === 'end' && duckedRef.current) {
        duckedRef.current = false;
        if (!el) return;
        const resumed = el.play();
        if (resumed && typeof resumed.then === 'function') {
          resumed.then(() => publishMetadata(useMediaStore.getState().current)).catch(() => reportPlayback('blocked'));
        }
      }
    };
    window.addEventListener(SPEECH_DUCK_EVENT, onDuck);
    return () => window.removeEventListener(SPEECH_DUCK_EVENT, onDuck);
  }, [publishMetadata, reportPlayback]);

  // Media Session buttons (earbud/lock-screen play, pause, next).
  useEffect(() => {
    try {
      const ms: any = typeof navigator === 'undefined' ? undefined : (navigator as any).mediaSession;
      if (!ms || typeof ms.setActionHandler !== 'function') return;
      ms.setActionHandler('play', () => control('resume'));
      ms.setActionHandler('pause', () => control('pause'));
      ms.setActionHandler('nexttrack', () => control('next'));
    } catch {}
  }, [control]);

  if (status === 'idle' && !current && !list.length) return null;

  const isVideo = current?.kind === 'video';
  const statusLine =
    status === 'searching'
      ? `Searching free sources for “${query}”…`
      : status === 'blocked'
        ? 'Playback blocked by your browser'
        : status === 'error'
          ? 'Nothing is streaming'
          : status === 'empty'
            ? 'No playable result'
            : status === 'paused'
              ? 'Paused'
              : buffering
                ? 'Buffering…'
                : current
                  ? `Playing from ${mediaSourceLabel(current.source)}`
                  : 'Ready';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    void request(value, kinds.length && kinds.length < 3 ? kinds : undefined);
    setTerm('');
  };

  const toggleKind = (kind: MediaKind) => {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  return (
    <section
      className={`media-player${expanded ? ' expanded' : ''}`}
      aria-label="Music and podcast player"
      data-testid="media-player"
    >
      <header className="media-player-head">
        <button
          type="button"
          className="media-player-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="media-status-dot" data-status={status} aria-hidden="true" />
          <span className="media-player-title">
            <strong>{current ? current.title : status === 'searching' ? 'Searching…' : 'Player'}</strong>
            <small>{statusLine}</small>
          </span>
          <Icon name={expanded ? 'close' : 'arrow'} />
        </button>
        <div className="media-player-controls">
          {current && !isVideo && (
            <button
              type="button"
              className="icon-button"
              onClick={() => control(status === 'playing' ? 'pause' : 'resume')}
              aria-label={status === 'playing' ? 'Pause playback' : 'Start playback'}
            >
              {status === 'playing' ? '❚❚' : '▶'}
            </button>
          )}
          {list.length > 1 && (
            <button type="button" className="icon-button" onClick={() => control('next')} aria-label="Play next result">
              ⏭
            </button>
          )}
          <button type="button" className="icon-button" onClick={() => control('close')} aria-label="Close player">
            ✕
          </button>
        </div>
      </header>

      {notice && (
        <p className="media-notice" role="status">
          {notice}
        </p>
      )}

      {current && !isVideo && (
        <audio
          ref={audioRef}
          key={current.url}
          src={current.url}
          controls
          preload="auto"
          className="media-audio"
          onPlay={() => reportPlayback('playing')}
          onPause={() => {
            if (!duckedRef.current) reportPlayback('paused');
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onEnded={() => control('next')}
          onError={() => {
            setBuffering(false);
            refuseCurrent(audioRef.current?.error?.code ?? undefined);
          }}
        />
      )}

      {current && isVideo && (
        <iframe
          key={current.url}
          src={current.url}
          title={current.title}
          className="media-video"
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
        />
      )}

      {expanded && (
        <div className="media-player-body">
          <form className="media-search" onSubmit={submit}>
            <label className="media-search-field">
              <span>Search songs, podcasts or videos</span>
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Try “kesariya”, “hanuman chalisa”, “cricket podcast”"
                aria-label="Search music or podcasts"
                maxLength={120}
              />
            </label>
            <div className="media-kind-row" role="group" aria-label="What to search for">
              {KIND_LABELS.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={kinds.includes(kind.id)}
                  onClick={() => toggleKind(kind.id)}
                >
                  {kind.label}
                </button>
              ))}
            </div>
            <button type="submit" className="primary-button" disabled={status === 'searching' || !term.trim()}>
              {status === 'searching' ? 'Searching…' : 'Play'}
            </button>
          </form>

          {list.length > 0 && (
            <ul className="media-results">
              {list.map((track, index) => (
                <li key={`${track.source}-${track.url}-${index}`}>
                  <button
                    type="button"
                    onClick={() => select(track)}
                    aria-current={track.url === current?.url ? 'true' : undefined}
                  >
                    <span className="media-result-kind" aria-hidden="true">
                      {track.kind === 'song' ? '🎵' : track.kind === 'podcast' ? '🎙️' : '📺'}
                    </span>
                    <span className="media-result-text">
                      <strong>{track.title}</strong>
                      <small>
                        {track.artist ? `${track.artist} · ` : ''}
                        {mediaSourceLabel(track.source)}
                        {track.url === current?.url ? ' · loaded' : ''}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {(status === 'empty' || status === 'error') && youtubeSearchUrl && (
            <a className="media-handoff" href={youtubeSearchUrl} target="_blank" rel="noreferrer">
              Free sources could not stream this — open the YouTube search instead
              <Icon name="arrow" />
            </a>
          )}

          <p className="media-honesty">
            Playback uses free, keyless community sources. They can be busy, region-blocked or offline, and
            OneBrain never claims a song is playing when it is not. Nothing is downloaded or stored.
          </p>
        </div>
      )}
    </section>
  );
}
