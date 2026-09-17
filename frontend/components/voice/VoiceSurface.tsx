'use client';
// The Voice tab: a full-screen listening surface for pockets, desks and car
// mounts. Same engine as Today (one hook, one transcript path), but built for
// a thumb and a dark room: one giant control, live captions, the last answers,
// and honest provider / retry / microphone states instead of a spinner.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAssistant } from '@/hooks/useAssistant';
import { useBackgroundKeepalive } from '@/hooks/useBackgroundKeepalive';
import { useAssistantStore } from '@/store/assistant';
import { useFeaturesStore } from '@/store/features';
import { unlockAudioOutput } from '@/lib/audio';
import { FeatureCards, FeatureHint } from '@/components/features/FeatureCards';
import { Icon } from '@/components/ui/Icon';
import { INTENT_HINTS } from '@/lib/intents';

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini (your key)',
  pollinations: 'Community AI',
  puter: 'Puter AI',
  wikipedia: 'Wikipedia',
  offline: 'Offline mode',
  'key-error': 'Key issue',
  server: 'Server',
};

/** Phrases worth tapping when your hands are busy — all of them run through the
 *  same transcript path a spoken line takes, so nothing is a secret door. */
const QUICK_SAYS = [
  'what expenses did I do today',
  'kharcha 200 chai',
  '20 pushups kar liye',
  'morning brief',
  'show my open tasks',
  'stop listening',
];

export function VoiceSurface() {
  const assistant = useAssistant();
  useBackgroundKeepalive(assistant.recover);
  const state = useAssistantStore();
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const startAttempt = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const speakRef = useRef(assistant.speak);
  speakRef.current = assistant.speak;

  // Feature cards (did-you-mean, confirmations) speak through this page's voice.
  useEffect(() => {
    useFeaturesStore.getState().setSpeaker((t) => speakRef.current(t));
    return () => useFeaturesStore.getState().setSpeaker(null);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [state.messages.length]);

  const turn = (text: string) => {
    void unlockAudioOutput();
    void assistant.handleTranscript(text);
  };

  const start = async () => {
    if (starting) return;
    void unlockAudioOutput();
    const request = ++startAttempt.current;
    setStarting(true);
    setNotice('');
    try {
      await assistant.startActive();
    } catch (e) {
      if (request !== startAttempt.current) return;
      setNotice(
        e instanceof Error ? e.message : 'Microphone unavailable. Type instead — everything below still works.',
      );
    } finally {
      if (request === startAttempt.current) setStarting(false);
    }
  };

  const lastAssistant = useMemo(
    () => state.messages.filter((m) => m.role === 'assistant').slice(-1)[0],
    [state.messages],
  );
  const listening = assistant.isActive;
  const status = starting
    ? 'Requesting microphone'
    : listening
      ? assistant.currentStatus
      : assistant.currentStatus === 'paused'
        ? 'Paused — microphone released'
        : 'Ready when you are';

  return (
    <div className="voice-screen">
      <header className="voice-head">
        <div>
          <span className="overline">FULL-SCREEN LISTENING</span>
          <h1>Voice</h1>
        </div>
        <Link prefetch={false} className="text-button" href="/">
          Back to Today
          <Icon name="arrow" />
        </Link>
      </header>

      <section className="voice-control" aria-label="Microphone control">
        <div className={`voice-orb${listening ? ' is-on' : ''}`} aria-hidden="true">
          {[10, 22, 34, 46, 60, 46, 34, 22, 10].map((h, i) => (
            <i key={i} style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
        <p className="voice-status" role="status" aria-live="polite">
          <span className={listening ? 'status-dot active' : 'status-dot'} />
          {status}
        </p>
        <button
          className="voice-primary"
          data-testid={listening ? 'stop-button' : 'active-button'}
          onClick={listening ? assistant.stopActive : () => void start()}
          disabled={starting}
        >
          {listening ? 'Stop listening' : starting ? 'Requesting microphone…' : 'Start talking'}
          <Icon name="mic" />
        </button>
        {starting && (
          <button
            className="text-button"
            onClick={() => {
              startAttempt.current += 1;
              assistant.stopActive();
              setStarting(false);
              setNotice('Microphone start cancelled.');
            }}
          >
            Cancel microphone start
          </button>
        )}
        <div className="voice-secondary">
          {listening && <button className="text-button" onClick={assistant.pauseActive}>Pause session</button>}
          {!listening && assistant.currentStatus === 'paused' && (
            <button className="text-button" onClick={() => void start()}>Resume</button>
          )}
          <button
            className={state.settings.silentMode ? 'text-button silent-mode-on' : 'text-button'}
            aria-pressed={!!state.settings.silentMode}
            title={state.settings.silentMode ? 'Silent Mode is ON — answers are text only. Tap to hear them.' : 'Spoken replies are on. Tap to mute them.'}
            onClick={() => {
              if (state.settings.silentMode) window.speechSynthesis?.cancel();
              state.updateSettings({ silentMode: !state.settings.silentMode });
            }}
          >
            {state.settings.silentMode ? '◌ Silent mode is on — tap to unmute' : '◌ Voice replies active — tap to mute'}
          </button>
          {assistant.hasReplay && (
            <button className="text-button" onClick={() => void assistant.replayLastReply()}>Say that again</button>
          )}
        </div>
        <p className="voice-privacy">
          Nothing is recorded until you press start. Speech is transcribed by your
          browser and only the words you send reach an AI.
        </p>
      </section>

      {state.liveTranscript && listening && (
        <p className="live-caption" role="status" data-testid="live-caption">
          <span className="live-dot" aria-hidden="true" />
          Hearing: {state.liveTranscript}…
        </p>
      )}

      {(notice || assistant.micNotice || state.storageNotice) && (
        <p role="alert" className="workspace-notice voice-notice">
          {notice || assistant.micNotice || state.storageNotice}
          {notice && !listening && (
            <button className="text-button" onClick={() => void start()}>Try the microphone again</button>
          )}
        </p>
      )}
      {assistant.voiceNotice && (
        <p role="status" className="voice-answer-notice">
          <span>{assistant.voiceNotice}</span>
          {assistant.hasReplay && (
            <button className="text-button" onClick={() => void assistant.replayLastReply()}>Play it now</button>
          )}
          <button className="text-button" onClick={() => assistant.clearVoiceNotice()}>Dismiss</button>
        </p>
      )}

      <section className="voice-answer" aria-label="OneBrain response" aria-live="polite">
        {assistant.currentStatus === 'processing' ? (
          <p className="voice-pending" role="status">Working on your question…</p>
        ) : lastAssistant ? (
          <>
            <p className="voice-answer-text">{lastAssistant.content}</p>
            {state.lastProvider && (
              <p className={`provider-badge${state.lastProvider === 'offline' ? ' is-offline' : ''}`} data-testid="provider-badge">
                {state.lastProvider === 'offline'
                  ? 'Offline answer — add a free Gemini key in You → Advanced for smarter replies.'
                  : `Answered by ${PROVIDER_LABELS[state.lastProvider] || state.lastProvider}`}
              </p>
            )}
            <p className="voice-answer-meta">{lastAssistant.meta || 'Answered on this device'}</p>
          </>
        ) : (
          <p className="voice-idle">
            Ask something, or say “kharcha 200 chai”, “2 roti khayi”, “task: renew
            the passport”. OneBrain answers about what you have already logged.
          </p>
        )}
        <FeatureCards say={turn} />
      </section>

      <section className="voice-quick" aria-label="Quick phrases">
        <h2>Or tap a phrase</h2>
        <div className="voice-chips">
          {QUICK_SAYS.map((text) => (
            <button key={text} onClick={() => turn(text)}>{text}</button>
          ))}
        </div>
        <details className="voice-more">
          <summary>Everything OneBrain understands without guessing</summary>
          <ul>
            {INTENT_HINTS.map((hint) => (
              <li key={hint.say}>
                <button onClick={() => turn(hint.say)}>“{hint.say}”</button>
                <span>{hint.label}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="voice-transcript" aria-label="This session">
        <h2>This session</h2>
        {state.messages.length ? (
          <ul>
            {state.messages.slice(-14).map((m) => (
              <li key={m.id} className={m.role}>
                <span>{m.role === 'user' ? 'You' : 'OneBrain'}</span>
                <p>{m.content}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="voice-empty">Nothing said yet this session.</p>
        )}
        <div className="sheet-actions">
          <button className="text-button" onClick={() => turn('new chat')}>Start a new chat</button>
          <Link prefetch={false} className="text-button" href="/control?panel=conversations">
            Saved conversations
            <Icon name="arrow" />
          </Link>
        </div>
      </section>
      <FeatureHint say={turn} />
    </div>
  );
}
