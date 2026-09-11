// Speaker awareness: pitch-based voice profiles.
//
// Honest scope: a web page cannot do true speaker diarization ("who exactly
// is talking") in real time. What it CAN do reliably:
//  1. Estimate vocal pitch from mic audio (autocorrelation, no server needed).
//  2. Guess male/female vocal range from pitch.
//  3. Learn the owner's baseline pitch (3-second enrollment) and flag when a
//     very different voice is heard, so answers are not silently mixed up.
//
// All helpers are pure functions over sample buffers -> fully unit-testable.

export interface VoiceProfile {
  pitchHz: number;
  samples: number;
}

// Autocorrelation pitch detection. Returns fundamental Hz or null when the
// frame is silent, noisy, or outside the human vocal range (50-500 Hz).
export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  const n = samples.length;
  if (n < 64 || sampleRate <= 0) return null;

  // Energy gate: ignore near-silence (background hum, quiet music bleed).
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
  if (energy / n < 0.0005) return null;

  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(n - 1, Math.ceil(sampleRate / 50));
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i + lag < n; i++) corr += samples[i] * samples[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;

  // Confidence gate: peak must clearly beat zero-lag energy ratio.
  let zero = 0;
  for (let i = 0; i < n; i++) zero += samples[i] * samples[i];
  if (bestCorr < zero * 0.3) return null;

  const hz = sampleRate / bestLag;
  if (hz < 50 || hz > 500) return null;
  return hz;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type VoiceRange = 'male' | 'female' | 'unknown';

// Adult male speech ~85-155 Hz, adult female ~165-255 Hz. Overlap/children -> unknown.
export function rangeFromPitch(hz: number | null): VoiceRange {
  if (hz == null) return 'unknown';
  if (hz >= 85 && hz < 160) return 'male';
  if (hz >= 165 && hz <= 300) return 'female';
  return 'unknown';
}

// 0..1 similarity between two pitch readings (1 = same voice, roughly).
export function pitchSimilarity(aHz: number, bHz: number): number {
  if (aHz <= 0 || bHz <= 0) return 0;
  const ratio = Math.min(aHz, bHz) / Math.max(aHz, bHz);
  return Math.max(0, Math.min(1, (ratio - 0.6) / 0.4));
}

// True when the heard voice is too far from the enrolled owner to be them.
export function isDifferentSpeaker(baselineHz: number | null, heardHz: number | null): boolean {
  if (baselineHz == null || heardHz == null) return false;
  return pitchSimilarity(baselineHz, heardHz) < 0.5;
}

export type IgnoreVerdict = 'answer' | 'drop-notice' | 'drop-silent';

// Decide BEFORE calling the AI: should this transcript get a reply?
// - No pitch info, or matches owner -> answer.
// - Stranger + strict mode ON -> drop with a notice (user opted in).
// - Stranger + low confidence -> drop silently (TV, other calls, passersby).
// - Stranger but confident -> answer anyway (better helpful than mute),
//   tagged so the user sees why. "Not you" undo covers the rest.
export function shouldIgnoreTranscript(opts: {
  baselineHz: number | null;
  heardHz: number | null;
  confidence?: number;
  ownerOnly: boolean;
}): IgnoreVerdict {
  const { baselineHz, heardHz, confidence, ownerOnly } = opts;
  if (!isDifferentSpeaker(baselineHz, heardHz)) return 'answer';
  if (ownerOnly) return 'drop-notice';
  if (typeof confidence === 'number' && confidence < 0.6) return 'drop-silent';
  return 'answer';
}

// Build a test tone: sine at hz + slight harmonic, like a vowel sound.
export function synthVowel(hz: number, sampleRate: number, seconds: number): Float32Array {
  const n = Math.floor(sampleRate * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(2 * Math.PI * hz * 2 * t);
  }
  return out;
}
