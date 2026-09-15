'use client';
import { useState } from 'react';
import { useMediaStore } from '@/store/media';
import { useAssistantStore } from '@/store/assistant';
import { mediaSourceLabel, type MediaKind } from '@/lib/media';
import { Icon } from '../ui/Icon';

const VOICE_EXAMPLES: { say: string; what: string }[] = [
  { say: 'play kesariya', what: 'Search and start a song' },
  { say: 'hanuman chalisa sunao', what: 'Works in Hindi, Hinglish or Marathi' },
  { say: 'play some podcast on cricket', what: 'Podcasts instead of songs' },
  { say: 'gaana band', what: 'Pause playback' },
  { say: 'phir se chalao', what: 'Resume playback' },
  { say: 'next song', what: 'Next result in the list' },
  { say: 'stop song', what: 'Close the player' },
];

const KINDS: { id: MediaKind; label: string }[] = [
  { id: 'song', label: 'Songs' },
  { id: 'podcast', label: 'Podcasts' },
  { id: 'video', label: 'Videos' },
];

/**
 * Your space → Music.
 *
 * The sticky player lives in the root layout; this panel is the readable
 * explanation plus a typed search for people who would rather not talk to a
 * phone on a train. Both drive the same store, so nothing can disagree.
 */
export function Music() {
  const status = useMediaStore((s) => s.status);
  const current = useMediaStore((s) => s.current);
  const list = useMediaStore((s) => s.list);
  const notice = useMediaStore((s) => s.notice);
  const query = useMediaStore((s) => s.query);
  const youtubeSearchUrl = useMediaStore((s) => s.youtubeSearchUrl);
  const request = useMediaStore((s) => s.request);
  const select = useMediaStore((s) => s.select);
  const control = useMediaStore((s) => s.control);

  const musicEnabled = useAssistantStore((s) => s.settings.musicEnabled !== false);
  const updateSettings = useAssistantStore((s) => s.updateSettings);

  const [term, setTerm] = useState('');
  const [kinds, setKinds] = useState<MediaKind[]>(['song']);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = term.trim();
    if (!value) return;
    void request(value, kinds.length && kinds.length < KINDS.length ? kinds : undefined);
  };

  return (
    <div className="panel-stack">
      <section className="settings-section">
        <h3>Music playback</h3>
        <p>
          Say <strong>“play &lt;song name&gt;”</strong> while talking, or search below. A small player stays at the
          bottom of the screen and follows you between Today and Your space.
        </p>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={musicEnabled}
            onChange={(event) => updateSettings({ musicEnabled: event.target.checked })}
          />
          <span>
            <strong>Allow music and podcast playback</strong>
            <small>
              Off means “play …” is answered with a message instead of searching. Nothing is downloaded or stored
              either way.
            </small>
          </span>
        </label>
      </section>

      <section className="settings-section">
        <h3>Search</h3>
        <form className="media-search" onSubmit={submit}>
          <label className="media-search-field">
            <span>Song, artist or podcast</span>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="kesariya, hanuman chalisa, cricket podcast"
              aria-label="Search music or podcasts"
              maxLength={120}
              disabled={!musicEnabled}
            />
          </label>
          <div className="media-kind-row" role="group" aria-label="What to search for">
            {KINDS.map((kind) => (
              <button
                key={kind.id}
                type="button"
                aria-pressed={kinds.includes(kind.id)}
                disabled={!musicEnabled}
                onClick={() =>
                  setKinds((prev) => (prev.includes(kind.id) ? prev.filter((k) => k !== kind.id) : [...prev, kind.id]))
                }
              >
                {kind.label}
              </button>
            ))}
          </div>
          <button className="primary-button" type="submit" disabled={!musicEnabled || status === 'searching' || !term.trim()}>
            {status === 'searching' ? 'Searching…' : 'Search and play'}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <h3>Now playing</h3>
        {current ? (
          <>
            <p className="plan-source">
              <strong>{current.title}</strong>
              {current.artist ? ` — ${current.artist}` : ''} · {mediaSourceLabel(current.source)} · {status}
            </p>
            <div className="sheet-actions">
              <button onClick={() => control(status === 'playing' ? 'pause' : 'resume')}>
                {status === 'playing' ? 'Pause' : 'Play'}
              </button>
              <button onClick={() => control('next')}>Next result</button>
              <button onClick={() => control('close')}>Close player</button>
            </div>
          </>
        ) : (
          <p>
            <small>
              {status === 'searching'
                ? `Searching free sources for “${query}”…`
                : 'Nothing is loaded. Search above, or say “play kesariya”.'}
            </small>
          </p>
        )}
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
        {list.length > 1 && (
          <ul className="media-results">
            {list.map((track, index) => (
              <li key={`${track.source}-${track.url}-${index}`}>
                <button type="button" onClick={() => select(track)} aria-current={track.url === current?.url ? 'true' : undefined}>
                  <span className="media-result-kind" aria-hidden="true">
                    {track.kind === 'song' ? '🎵' : track.kind === 'podcast' ? '🎙️' : '📺'}
                  </span>
                  <span className="media-result-text">
                    <strong>{track.title}</strong>
                    <small>
                      {track.artist ? `${track.artist} · ` : ''}
                      {mediaSourceLabel(track.source)}
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
      </section>

      <section className="settings-section">
        <h3>What you can say</h3>
        <ul className="phrase-list">
          {VOICE_EXAMPLES.map((example) => (
            <li key={example.say}>
              <strong>“{example.say}”</strong>
              <span>{example.what}</span>
            </li>
          ))}
        </ul>
        <p>
          <small>
            “stop” and “continue” still control the listening session, so music uses “stop song”, “gaana band” and
            “phir se chalao”. With strict voice mode on, only your enrolled voice can start playback.
          </small>
        </p>
      </section>

      <section className="settings-section">
        <h3>Sources and limits</h3>
        <p>
          <small>
            Playback uses free, keyless community sources: a JioSaavn search API for songs, the Apple podcast
            directory plus each show’s RSS feed for episodes, and public Invidious instances for video. No account, no
            key and no payment is involved, and nothing is downloaded to this device.
          </small>
        </p>
        <p>
          <small>
            These sources are run by other people. They can be busy, rate-limited, region-blocked or offline. When a
            stream fails, OneBrain tries the next result and then says so plainly — it never shows a playing song that
            is not playing.
          </small>
        </p>
      </section>
    </div>
  );
}
