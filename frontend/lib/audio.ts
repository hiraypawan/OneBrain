// Audio device helpers: let the user pin mic + speaker so OneBrain can share
// the phone with music, calls, and other apps instead of fighting them.
//
// Honest platform notes:
// - Mic input device: selectable via getUserMedia deviceId (Chrome/Android/desktop).
// - Speaker output: routable ONLY for our <audio> playback via setSinkId
//   (Chrome). speechSynthesis (browser voice) always uses the OS default.
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
