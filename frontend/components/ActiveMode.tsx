'use client';
import { useEffect, useState } from 'react';
import { useAssistant } from '@/hooks/useAssistant';
import { useAssistantStore } from '@/store/assistant';
import { useBackgroundKeepalive } from '@/hooks/useBackgroundKeepalive';
import { StatusIndicator } from './StatusIndicator';
import { splitReply } from '@/lib/speech';
import { bgStateLabel } from '@/lib/background';
import FluidOrb from './rare/fluid-orb';
import { MediaPlayer } from './MediaPlayer';
import { listAudioDevices, outputSelectionSupported, type AudioDevice } from '@/lib/audio';

// Pin mic + speaker so OneBrain shares the phone with music, calls and other
// apps: e.g. phone mic for commands while earbuds play music, or TTS forced
// to the neckband. Labels appear after mic permission is granted (browser rule).
function DevicePanel() {
  const micDeviceId = useAssistantStore((s) => s.micDeviceId);
  const speakerDeviceId = useAssistantStore((s) => s.speakerDeviceId);
  const setMicDeviceId = useAssistantStore((s) => s.setMicDeviceId);
  const setSpeakerDeviceId = useAssistantStore((s) => s.setSpeakerDeviceId);
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [outOK] = useState(outputSelectionSupported);

  const refresh = async () => {
    const d = await listAudioDevices();
    setInputs(d.inputs);
    setOutputs(d.outputs);
  };

  useEffect(() => {
    refresh();
    // Reload when: OS plugs/unplugs something, or mic permission is granted
    // (browsers hide Bluetooth labels until then — the #1 "no devices" cause).
    const onChange = () => {
      refresh();
    };
    try {
      navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    } catch {}
    window.addEventListener('onebrain-devices-changed', onChange);
    return () => {
      try {
        navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
      } catch {}
      window.removeEventListener('onebrain-devices-changed', onChange);
    };
  }, []);

  return (
    <div className="mt-3 p-3 bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md text-left text-sm space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-bold">🎧 Audio devices</span>
        <button onClick={refresh} className="text-xs underline text-gray-400">Refresh</button>
      </div>
      <label className="flex justify-between items-center gap-2">
        Mic
        <select
          value={micDeviceId || ''}
          onChange={(e) => setMicDeviceId(e.target.value || null)}
          className="bg-black border border-gray-700 rounded px-2 py-1 max-w-[220px]"
        >
          <option value="">Default mic</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </label>
      <label className="flex justify-between items-center gap-2">
        Speaker
        <select
          value={speakerDeviceId || ''}
          onChange={(e) => setSpeakerDeviceId(e.target.value || null)}
          disabled={!outOK}
          className="bg-black border border-gray-700 rounded px-2 py-1 max-w-[220px] disabled:opacity-50"
        >
          <option value="">OS default</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-gray-500">
        {inputs.length === 0 && outputs.length === 0
          ? 'No devices listed yet — press Active once (mic permission reveals Bluetooth names), then come back here.'
          : outOK
            ? 'Speaker choice applies to cloud voices; phone voices always use the OS default.'
            : 'This browser picks the speaker itself (iOS/Safari rule).'}
        {' '}Stopping Active releases the mic instantly for other apps.
      </p>
    </div>
  );
}

function MessageBubble({ role, content, meta }: { role: string; content: string; meta?: string }) {
  if (role === 'user') {
    return (
      <div className="p-3 rounded-lg bg-gray-800">
        <div className="text-xs text-gray-400">You{meta ? ` · ${meta}` : ''}</div>
        <div>{content}</div>
      </div>
    );
  }
  // Assistant replies are bilingual: spoken part in your language + English below.
  const { spoken, english } = splitReply(content);
  return (
    <div className="p-3 rounded-lg bg-gray-900 border border-gray-700">
      <div className="text-xs text-gray-400">OneBrain</div>
      <div>{spoken}</div>
      {english && <div className="mt-2 pt-2 border-t border-gray-800 text-sm text-gray-300">EN: {english}</div>}
    </div>
  );
}

function friendlyMicError(e: any): string {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone blocked. Click the 🔒/🎤 icon in the address bar → allow microphone → press Active again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone found on this device. Type below instead, or connect a mic/earbuds.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'Microphone is busy (another app is using it). Close that app and try again.';
  if (name === 'MicApiMissing')
    return 'This browser/page cannot access the mic. Use Chrome/Edge on http://localhost:3000 (or any https:// site).';
  if (name === 'MicNoHardware')
    return 'Browser ko koi mic dikhai nahi de raha. Your neckband is likely connected music-only: PC/phone Sound settings me Input check karo (neckband Hands-Free ON), ya laptop ka built-in mic use karo. Brave me Shields down + mic Allow karo.';
  return e?.message || 'Could not start the microphone. Allow mic access and try again.';
}

export function ActiveMode() {
  const { startActive, stopActive, speak, isActive, currentStatus, messages, handleTranscript, micNotice, recover } = useAssistant();
  const [error, setError] = useState('');
  const [step, setStep] = useState('');
  const [starting, setStarting] = useState(false);
  const [typed, setTyped] = useState('');
  const [checks, setChecks] = useState({ secure: true, micApi: true, speechApi: true, isiOS: false });
  const { bgState } = useBackgroundKeepalive(recover);

  useEffect(() => {
    setChecks({
      secure: window.isSecureContext,
      micApi: !!navigator.mediaDevices?.getUserMedia,
      speechApi: !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
      isiOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    });
  }, []);

  // Notification "Stop" action (from SW) + auto-recovery when the tab
  // becomes visible again (back from another app / notification tap).
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if ((e.data as any)?.type === 'STOP_ASSISTANT') stopActive();
    };
    const onVis = () => {
      if (!document.hidden) recover();
    };
    // Leaving the page (link tap, close, reload): hand the mic straight back
    // to calls, recorders and other apps instead of holding it.
    const onHide = () => stopActive();
    try {
      (navigator as any).serviceWorker?.addEventListener('message', onMsg);
    } catch {}
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      try {
        (navigator as any).serviceWorker?.removeEventListener('message', onMsg);
      } catch {}
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [stopActive, recover]);

  const onStart = async () => {
    if (starting || isActive) return; // no double-tap races
    setError('');
    setStarting(true);
    setStep('Requesting microphone… allow it in the browser popup');
    // If the mic request hangs (popup hidden, mic held by another app),
    // say so instead of spinning silently forever.
    const nag = setTimeout(() => {
      setStep('Still waiting — allow the mic in the browser popup (address-bar icon). If another app uses the mic, close it, then Stop and retry.');
    }, 8000);
    try {
      await startActive();
      setStep('');
    } catch (e: any) {
      console.error('startActive failed:', e);
      setStep('');
      setError(friendlyMicError(e));
    } finally {
      clearTimeout(nag);
      setStarting(false);
    }
  };

  const ORB_COLORS = {
    idle: '#374151',
    listening: '#22C55E',
    processing: '#EAB308',
    speaking: '#3B82F6',
    error: '#EF4444',
  } as const;

  return (
    <div className="flex flex-col items-center text-center py-8">
      <MediaPlayer />
      <StatusIndicator status={currentStatus} />
      <div className="my-6">
        <FluidOrb size={190} color={ORB_COLORS[currentStatus]} />
      </div>
      <p className="text-2xl mb-2">
        {currentStatus === 'listening' && 'Listening... speak now'}
        {currentStatus === 'processing' && 'Thinking...'}
        {currentStatus === 'speaking' && 'Speaking in your earbuds...'}
        {currentStatus === 'idle' && 'Press Active and talk'}
        {currentStatus === 'error' && 'Error — check connection'}
      </p>
      <p className="text-gray-400 text-sm mb-6 max-w-md">
        Connect Bluetooth earbuds in phone settings first. Audio output routes to earbuds automatically. Earbud play/pause = start/stop, next = repeat answer.
      </p>

      {step && <p className="text-yellow-300 mb-4">⏳ {step}</p>}
      {checks.isiOS && (
        <div className="mb-4 p-3 bg-blue-950 border border-blue-700 rounded-xl max-w-md text-sm text-left">
          iPhone note: on most iPhones the mic pauses when you leave the app —
          but some setups keep listening even locked (keep this page open for best
          results). Watch the 📡 line below: it always shows the live truth.
        </div>
      )}
      {error && (
        <div className="mb-4 p-4 bg-red-950 border border-red-700 rounded-xl max-w-md text-left">
          <div className="font-bold text-red-300 mb-1">Couldn&apos;t start</div>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {!isActive ? (
        <button onClick={onStart} disabled={starting} data-testid="active-button" className="px-10 py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl text-xl font-bold">
          {starting ? '⏳ Starting…' : '▶ Active'}
        </button>
      ) : (
        <button onClick={stopActive} data-testid="stop-button" className="px-10 py-4 bg-red-600 hover:bg-red-700 rounded-xl text-xl font-bold">
          ⏹ Stop
        </button>
      )}

      {micNotice && (
        <div className="mt-3 p-3 bg-yellow-950 border border-yellow-700 rounded-xl max-w-md text-sm text-yellow-200">
          {micNotice}
        </div>
      )}

      {/* Hold-to-talk: mic is live only while pressed. Best mode when music
          plays or earbuds are shared with another device (multipoint). */}
      <button
        onPointerDown={() => { if (!isActive) onStart(); }}
        onPointerUp={() => { if (isActive) stopActive(); }}
        onPointerLeave={() => { if (isActive) stopActive(); }}
        onPointerCancel={() => { if (isActive) stopActive(); }}
        onContextMenu={(e) => e.preventDefault()}
        className="mt-3 px-6 py-3 bg-purple-700 hover:bg-purple-600 rounded-xl font-bold select-none"
      >
        🎙 Hold to talk
      </button>

      <button
        onClick={() => speak('Speaker test. If you hear this in your earbuds, audio output works.')}
        className="mt-3 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm"
      >
        🔊 Test speaker (no mic needed)
      </button>
      <a href="/night" className="mt-2 text-xs text-gray-500 underline">
        🌙 Black-screen battery mode
      </a>
      <DevicePanel />

      <div className="mt-4 text-xs text-gray-500 space-y-1">
        <div>📡 {bgStateLabel(bgState, checks.isiOS)}</div>
        <div>{checks.secure ? '✓' : '✗'} Secure page (localhost/https)</div>
        <div>{checks.micApi ? '✓' : '✗'} Microphone API available</div>
        <div>{checks.speechApi ? '✓ Continuous voice recognition' : '⚠ No continuous voice recognition in this browser — use Chrome/Edge, or type below'}</div>
      </div>

      <div className="mt-6 flex gap-2 w-full max-w-md">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or type here (fallback)..."
          className="flex-1 px-3 py-2 rounded bg-gray-900 border border-gray-700 text-white"
        />
        <button
          onClick={() => { handleTranscript(typed); setTyped(''); }}
          className="px-4 py-2 bg-blue-600 rounded"
        >
          Send
        </button>
      </div>

      <div className="mt-8 w-full max-w-md text-left space-y-3">
        {messages.slice(-10).map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} meta={m.meta} />
        ))}
      </div>
    </div>
  );
}
