// Audio device helpers: let the user pin mic + speaker so OneBrain can share
// the phone with music, calls, and other apps instead of fighting them.
//
// Honest platform notes:
// - Mic input device: selectable via getUserMedia deviceId (Chrome/Android/desktop).
// - Speaker output: routable ONLY for our <audio> playback via setSinkId
//   (Chrome). speechSynthesis (browser voice) always uses the OS default, so
//   we detect the OS default, show which device the voice will actually use,
//   keep the list fresh on connect/disconnect, and offer a routed test tone.
// - iOS Safari supports neither picker: OS decides everything.

export interface MicChoice {
  deviceId?: string;
}

export function micConstraints(deviceId?: string | null): any {
  const audio: any = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}

export function outputSelectionSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof HTMLMediaElement !== 'undefined' &&
      'setSinkId' in HTMLMediaElement.prototype
    );
  } catch {
    return false;
  }
}

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'input' | 'output';
}

export async function listAudioDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  const empty = { inputs: [], outputs: [] };
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    if (!devices) return empty;
    const inputs: AudioDevice[] = [];
    const outputs: AudioDevice[] = [];
    for (const d of devices) {
      if (d.kind === 'audioinput') inputs.push({ deviceId: d.deviceId, label: d.label || 'Microphone', kind: 'input' });
      else if (d.kind === 'audiooutput') outputs.push({ deviceId: d.deviceId, label: d.label || 'Speaker', kind: 'output' });
    }
    return { inputs, outputs };
  } catch {
    return empty;
  }
}

// How many mic inputs does the browser expose right now? (Count is visible
// even before permission; labels are not.) Zero usually means the OS exposes
// no input at all — e.g. a neckband connected music-only (A2DP) with its
// Hands-Free/input profile disabled.
export async function countAudioInputs(): Promise<number> {
  try {
    const { inputs } = await listAudioDevices();
    return inputs.length;
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Output (speaker / neckband) detection and honest routing
//
// The platform truth, spelled out because it is the #1 cause of "I can't hear
// him on my neckband":
//   * <audio> playback CAN be pinned to a device via setSinkId (Chrome/Edge).
//   * window.speechSynthesis CANNOT — the browser hands it to the OS and the
//     OS uses whichever output is the *system default*.
// So the app cannot move spoken replies onto a chosen neckband. What it CAN
// do is detect the devices, detect which one the system default is, tell the
// user plainly which device the voice will come out of, keep the selection
// fresh when a neckband connects or drops, and play a test tone through a
// chosen device so "is it even working?" is answerable in one tap.
// ---------------------------------------------------------------------------

export interface OutputDevice {
  deviceId: string;
  label: string;
  /** Chrome exposes a synthetic `default` entry mirroring the OS default. */
  isDefault: boolean;
}

const DEFAULT_PREFIX = /^(default|system default)\s*[-–—:]\s*/i;

/** Strip Chrome's "Default - " prefix so labels read like the OS name. */
export function cleanDeviceLabel(label: string | undefined | null, fallback = 'Speaker'): string {
  const raw = String(label || '').replace(DEFAULT_PREFIX, '').trim();
  return raw || fallback;
}

export async function listOutputDevices(): Promise<OutputDevice[]> {
  const { outputs } = await listAudioDevices();
  return outputs.map((d) => ({
    deviceId: d.deviceId,
    label: cleanDeviceLabel(d.label, 'Speaker'),
    isDefault: d.deviceId === 'default' || DEFAULT_PREFIX.test(String(d.label || '')),
  }));
}

/** The OS default output, as reported by the browser (`default` entry). */
export function defaultOutput(outputs: OutputDevice[] | null | undefined): OutputDevice | null {
  const list = Array.isArray(outputs) ? outputs : [];
  const explicit = list.find((d) => d?.deviceId === 'default');
  if (explicit) return explicit;
  return list.find((d) => d?.isDefault) || null;
}

/** Concrete (non-synthetic) devices only — what the user can actually pick. */
export function pickableOutputs(outputs: OutputDevice[] | null | undefined): OutputDevice[] {
  return (Array.isArray(outputs) ? outputs : []).filter((d) => d?.deviceId && d.deviceId !== 'default');
}

/**
 * Auto-detection: keep the user's pin while that device is still plugged in;
 * otherwise fall back to the system default, then to the first device.
 * Returns null only when the OS exposes no output at all.
 */
export function autoPickOutput(
  outputs: OutputDevice[] | null | undefined,
  previousId?: string | null,
): string | null {
  const pickable = pickableOutputs(outputs);
  if (previousId && pickable.some((d) => d.deviceId === previousId)) return previousId;
  if (!pickable.length) return null;
  // The system default mirrors a real device; match it by label so the pin is
  // a concrete deviceId rather than the synthetic 'default'.
  const def = defaultOutput(outputs);
  if (def) {
    const twin = pickable.find((d) => d.label && d.label === def.label);
    if (twin) return twin.deviceId;
  }
  return pickable[0].deviceId;
}

export type SpeakerMode = 'none' | 'system-default' | 'routed' | 'mismatch' | 'unavailable';

export interface SpeakerPlan {
  mode: SpeakerMode;
  /** Device that will carry spoken replies, when known. */
  deviceId: string | null;
  label: string | null;
  /** What the OS default output currently is. */
  defaultLabel: string | null;
  /** True when this browser can pin <audio> playback to a device. */
  canRoute: boolean;
  message: string;
  hint: string | null;
}

/**
 * Explain, in one message, exactly where sound will come from and why a chosen
 * neckband may still stay quiet for *spoken* replies.
 */
export function speakerPlan(input: {
  outputs: OutputDevice[] | null | undefined;
  chosenId?: string | null;
  routingSupported?: boolean;
}): SpeakerPlan {
  const outputs = Array.isArray(input.outputs) ? input.outputs : [];
  const canRoute = input.routingSupported === true;
  const def = defaultOutput(outputs);
  const defaultLabel = def ? def.label : null;
  const pickable = pickableOutputs(outputs);

  if (!pickable.length && !def) {
    return {
      mode: 'none',
      deviceId: null,
      label: null,
      defaultLabel: null,
      canRoute,
      message: 'No output device is visible to the browser yet.',
      hint: 'Connect the neckband or speaker, then allow microphone permission once — browsers hide device names until it is granted.',
    };
  }

  const chosen = input.chosenId
    ? pickable.find((d) => d.deviceId === input.chosenId) || null
    : null;
  if (input.chosenId && !chosen) {
    return {
      mode: 'unavailable',
      deviceId: autoPickOutput(outputs, null),
      label: null,
      defaultLabel,
      canRoute,
      message: 'The selected output is no longer connected.',
      hint: defaultLabel
        ? `Replies will use the system default (${defaultLabel}) until you pick a device again.`
        : 'Pick an output device again, or reconnect the one you had selected.',
    };
  }

  const target = chosen || def || pickable[0];
  const isSystemDefault = !chosen || (!!def && chosen.deviceId === def.deviceId) || (!!def && chosen.label === def.label);

  if (isSystemDefault) {
    return {
      mode: 'system-default',
      deviceId: target?.deviceId || null,
      label: target?.label || null,
      defaultLabel,
      canRoute,
      message: target?.label
        ? `Spoken replies play on ${target.label} — the system default output.`
        : 'Spoken replies play on the system default output.',
      hint: null,
    };
  }

  if (!canRoute) {
    return {
      mode: 'mismatch',
      deviceId: target?.deviceId || null,
      label: target?.label || null,
      defaultLabel,
      canRoute,
      message: `This browser sends all speech to the system default output${defaultLabel ? ` (${defaultLabel})` : ''}.`,
      hint: `Make ${target?.label || 'your neckband'} the system default output in your device sound settings to hear replies there.`,
    };
  }

  return {
    mode: 'routed',
    deviceId: target?.deviceId || null,
    label: target?.label || null,
    defaultLabel,
    canRoute,
    message: `Audio playback is routed to ${target?.label || 'the selected device'}.`,
    hint: `Spoken replies still follow the system default${defaultLabel ? ` (${defaultLabel})` : ''}. Make ${target?.label || 'that device'} the system default to hear the voice there too.`,
  };
}

/**
 * Live detection: refresh when a neckband or speaker connects/disconnects.
 * Returns an unsubscribe function; a no-op where the API is missing.
 */
export function watchAudioDevices(onChange: () => void): () => void {
  try {
    const md: any = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md || typeof md.addEventListener !== 'function') return () => {};
    md.addEventListener('devicechange', onChange);
    return () => {
      try {
        md.removeEventListener('devicechange', onChange);
      } catch {}
    };
  } catch {
    return () => {};
  }
}

// --- Test tone -------------------------------------------------------------
// A 0.4 s 440 Hz beep as a tiny WAV data URL, so it can go through an
// <audio> element and therefore honour setSinkId (speechSynthesis cannot).

function wavDataUrl(freq = 440, seconds = 0.4, sampleRate = 22050): string {
  const frames = Math.max(1, Math.floor(sampleRate * seconds));
  const dataSize = frames * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < frames; i += 1) {
    // Short fade in/out so it clicks less on cheap earbuds.
    const env = Math.min(1, i / (sampleRate * 0.02), (frames - i) / (sampleRate * 0.05));
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.28 * Math.max(0, env);
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true);
  }
  // Base64 without btoa's latin1 limit: chunk the bytes.
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return `data:audio/wav;base64,${b64}`;
}

export function testToneDataUrl(): string {
  return wavDataUrl();
}

/**
 * Play the test tone, optionally pinned to a device. Resolves true only when
 * playback actually started, so the UI can report a real failure.
 */
export async function playTestTone(sinkId?: string | null, timeoutMs = 4000): Promise<boolean> {
  if (typeof Audio === 'undefined') return false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        audio.pause();
      } catch {}
      resolve(ok);
    };
    const audio = new Audio(testToneDataUrl());
    const timer = setTimeout(() => finish(false), timeoutMs);
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    const start = () => {
      try {
        const p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(() => finish(false));
      } catch {
        finish(false);
      }
    };
    if (sinkId && typeof (audio as any).setSinkId === 'function') {
      try {
        const r = (audio as any).setSinkId(sinkId);
        if (r && typeof r.then === 'function') r.then(start, start);
        else start();
      } catch {
        start();
      }
    } else {
      start();
    }
  });
}

export type MicFailurePlan = 'retry-default' | 'no-hardware' | 'passthrough';

// Decide what a mic failure MEANS instead of showing a dead-end message:
// - pinned (saved) device gone -> drop the pin, retry default once.
// - no input hardware visible at all -> say exactly that + OS-level fixes.
// - anything else -> let the original error (busy/blocked) speak.
export function diagnoseMicError(
  errName: string,
  hadPinnedDevice: boolean,
  inputCount: number
): MicFailurePlan {
  if ((errName === 'OverconstrainedError' || errName === 'NotFoundError') && hadPinnedDevice) {
    return 'retry-default';
  }
  if ((errName === 'NotFoundError' || errName === 'OverconstrainedError') && inputCount === 0) {
    return 'no-hardware';
  }
  return 'passthrough';
}

// ---------------------------------------------------------------------------
// Spoken-reply playback engine
//
// Spoken answers are played as AUDIO BYTES through one shared <audio> element
// rather than handed to speechSynthesis. That single change is what makes
// replies audible and correctly routed on real devices:
//   * it plays on every platform (iOS Safari, Android Chrome, macOS, Windows);
//   * it follows the OS output automatically when nothing is pinned — connect
//     a neckband or earbuds and the sound goes there with no picking;
//   * it can be pinned with setSinkId where the browser supports it;
//   * it survives screen lock, shows in the lock screen and responds to
//     headset buttons through the Media Session API.
// The element is created once and reused, so a single user gesture unlocks
// audio for the whole session (iOS refuses later programmatic playback
// otherwise).
// ---------------------------------------------------------------------------

let speechEl: HTMLAudioElement | null = null;
let speechObjectUrl: string | null = null;
let stopCurrent: (() => void) | null = null;

// 60 ms of digital silence — used only to unlock playback inside a gesture.
export const SILENT_WAV =
  'data:audio/wav;base64,UklGRmQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

export function speechAudioElement(): HTMLAudioElement | null {
  try {
    if (typeof Audio === 'undefined') return null;
    if (!speechEl) {
      speechEl = new Audio();
      speechEl.preload = 'auto';
      (speechEl as any).playsInline = true;
      speechEl.setAttribute('playsinline', 'true');
      // Keep the element out of the accessibility tree; it is a speaker.
      speechEl.setAttribute('aria-hidden', 'true');
    }
    return speechEl;
  } catch {
    return null;
  }
}

/** Unlock the shared element. Must be called inside a user gesture (iOS). */
export async function unlockAudioOutput(): Promise<boolean> {
  const el = speechAudioElement();
  let ok = false;
  if (el) {
    try {
      if (!el.src) el.src = SILENT_WAV;
      await el.play();
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
      ok = true;
    } catch {}
  }
  if (typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {}
  }
  return ok;
}

/**
 * Unlock on the first real user gesture anywhere in the app, then stop
 * listening. Returns an unsubscribe function.
 */
export function primeAudioOutputOnGesture(target: any = typeof document === 'undefined' ? null : document): () => void {
  if (!target || typeof target.addEventListener !== 'function') return () => {};
  let done = false;
  const events = ['pointerdown', 'touchend', 'click', 'keydown'];
  const run = () => {
    if (done) return;
    done = true;
    void unlockAudioOutput();
    for (const e of events) {
      try {
        target.removeEventListener(e, run, true);
      } catch {}
    }
  };
  for (const e of events) {
    try {
      target.addEventListener(e, run, { capture: true, passive: true });
    } catch {}
  }
  return () => {
    if (done) return;
    done = true;
    for (const e of events) {
      try {
        target.removeEventListener(e, run, true);
      } catch {}
    }
  };
}

export function stopSpeechPlayback(): void {
  try {
    stopCurrent?.();
  } catch {}
  stopCurrent = null;
}

// ---------------------------------------------------------------------------
// Output routing state
// ---------------------------------------------------------------------------

let lastOutputs: OutputDevice[] = [];
let resolvedOutputId: string | null = null;
let resolvedOutputLabel: string | null = null;

export function knownOutputs(): OutputDevice[] {
  return lastOutputs;
}

export function resolvedOutput(): { deviceId: string | null; label: string | null } {
  return { deviceId: resolvedOutputId, label: resolvedOutputLabel };
}

/**
 * Which device should carry the spoken reply? A device the user explicitly
 * pinned wins while it is still connected; otherwise the system default is
 * used — i.e. whatever the user's phone/PC is currently playing through, which
 * is exactly where the neckband/earbuds are.
 */
export function activeSinkId(pinned?: string | null): string | null {
  const outputs = lastOutputs;
  if (pinned && outputs.some((d) => d.deviceId === pinned)) return pinned;
  return resolvedOutputId;
}

/** Re-read the output list and re-resolve the automatic target. */
export async function refreshOutputRouting(
  pinned?: string | null,
): Promise<{ deviceId: string | null; label: string | null }> {
  const outputs = await listOutputDevices();
  lastOutputs = outputs;
  const chosen = autoPickOutput(outputs, pinned);
  resolvedOutputId = chosen;
  resolvedOutputLabel = outputs.find((d) => d.deviceId === chosen)?.label || null;
  if (!resolvedOutputLabel) {
    const def = defaultOutput(outputs);
    resolvedOutputLabel = def?.label || null;
  }
  return resolvedOutput();
}

/**
 * Keep routing honest without asking the user anything: refresh now, whenever
 * a device connects/disconnects, and whenever the tab becomes visible again
 * (some platforms only publish device labels after a permission grant or a
 * screen unlock).
 */
let routingStarted = false;

export async function startOutputRouting(getPinned: () => string | null): Promise<() => void> {
  // Several components may call this (workspace + mini player). One watcher is
  // enough, and the pin is read fresh from the store on every refresh anyway.
  if (routingStarted) return () => {};
  routingStarted = true;
  await refreshOutputRouting(getPinned());
  const onChange = () => {
    void refreshOutputRouting(getPinned());
  };
  const stopWatch = watchAudioDevices(onChange);
  let stopVisibility = () => {};
  try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const onVis = () => onChange();
      document.addEventListener('visibilitychange', onVis);
      stopVisibility = () => {
        try {
          document.removeEventListener('visibilitychange', onVis);
        } catch {}
      };
    }
  } catch {}
  return () => {
    routingStarted = false;
    stopWatch();
    stopVisibility();
  };
}

// ---------------------------------------------------------------------------
// Playing a spoken reply
// ---------------------------------------------------------------------------

export interface SpeechPlayback {
  stop: () => void;
  /** Resolves true only when the reply played to the end. */
  ended: Promise<boolean>;
}

function publishMediaSession(text: string) {
  try {
    if (typeof navigator === 'undefined') return;
    const ms: any = (navigator as any).mediaSession;
    if (!ms) return;
    const MM: any = typeof window === 'undefined' ? undefined : (window as any).MediaMetadata;
    if (MM) ms.metadata = new MM({ title: String(text || '').slice(0, 90) || 'Answer', artist: 'OneBrain', album: 'Voice reply' });
    ms.playbackState = 'playing';
  } catch {}
}

function clearMediaSession() {
  try {
    const ms: any = (navigator as any).mediaSession;
    if (ms) ms.playbackState = 'none';
  } catch {}
}

/**
 * Play synthesized reply audio. Resolves null when playback could not start
 * (autoplay blocked, no element, decode error) so the caller can fall back to
 * the browser voice and say why.
 */
export async function playSpeechBlob(
  blob: Blob,
  opts: { sinkId?: string | null; text?: string } = {},
): Promise<SpeechPlayback | null> {
  const el = speechAudioElement();
  if (!el || !blob || blob.size < 500) return null;
  stopSpeechPlayback();
  try {
    if (speechObjectUrl) URL.revokeObjectURL(speechObjectUrl);
  } catch {}
  let url: string;
  try {
    url = URL.createObjectURL(blob);
    speechObjectUrl = url;
  } catch {
    return null;
  }
  el.src = url;
  el.currentTime = 0;
  // Route to the pinned device when the browser allows it. Without setSinkId
  // (iOS/Safari) the OS decides — which is where the user's Bluetooth audio
  // already is, so it still lands on the neckband.
  if (opts.sinkId && typeof (el as any).setSinkId === 'function') {
    try {
      const r = (el as any).setSinkId(opts.sinkId);
      if (r && typeof r.then === 'function') await r.catch(() => {});
    } catch {}
  }
  publishMediaSession(opts.text || '');

  let settle: (ok: boolean) => void = () => {};
  let settled = false;
  const ended = new Promise<boolean>((resolve) => {
    settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.onended = null;
      el.onerror = null;
      el.onpause = null;
      clearMediaSession();
      resolve(ok);
    };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    try {
      el.pause();
    } catch {}
    settle(false);
  };
  el.onended = () => settle(true);
  el.onerror = () => settle(false);
  el.onpause = () => settle(false);
  // Ceiling in case `ended` never fires: decoding errors on some phones.
  const ceiling = Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 + 5000 : 60_000;
  timer = setTimeout(stop, Math.min(Math.max(ceiling, 5000), 180_000));
  stopCurrent = stop;

  try {
    await el.play();
  } catch {
    settle(false);
    stopCurrent = null;
    return null;
  }
  return {
    stop,
    ended: ended.then((ok) => {
      if (stopCurrent === stop) stopCurrent = null;
      return ok;
    }),
  };
}
