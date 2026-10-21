// Environment recognition: how loud is the room around the microphone, and
// what should the assistant do differently because of it?
//
// Honest scope: a browser cannot classify "kitchen vs office" from an audio
// buffer, and this module does not pretend to. What it CAN measure reliably is
// the noise floor — the sustained energy in the room between words — and that
// number genuinely changes how long a turn should wait, how much confidence a
// transcript needs, and whether an unenrolled voice nearby should be answered.
//
// Pure functions over sample buffers and RMS readings: no DOM, no timers, fully
// unit-testable.

export type EnvironmentClass = 'quiet' | 'home' | 'noisy' | 'loud';

export interface EnvironmentTuning {
  /** Class this tuning belongs to. */
  env: EnvironmentClass;
  /** Short human label, e.g. "Noisy room". */
  label: string;
  /** One honest sentence about what the app does about it. */
  advice: string;
  /** Recommended pause length for this room (absolute), shown to the user. */
  endOfSpeechMs: number;
  /**
   * Multiplier applied to the user's own end-of-speech wait. The user's choice
   * is a preference, not a constant: a quiet room may shorten it, a loud one
   * lengthens it, and the result is clamped to the same 700–4000 ms band the
   * setting itself uses.
   */
  speechWaitFactor: number;
  /** Real (non-zero) confidences below this are treated as bleed/noise. */
  minConfidence: number;
  /** How long a confidence-0 final waits for a better one. */
  holdMs: number;
  /** Only the enrolled voice is answered (needs a baseline to have any effect). */
  requireOwnerVoice: boolean;
  /** Pitch similarity (0..1) below which a voice counts as "not the owner". */
  ownerTolerance: number;
}

/** Root-mean-square energy of a time-domain frame, 0..1. */
export function rmsOf(samples: Float32Array | number[]): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / n);
}

/**
 * Classify a sustained noise floor.
 *
 * Thresholds are RMS values measured on real phone/laptop mics after echo
 * cancellation. They are deliberately conservative: a quiet room reads
 * ~0.0005–0.003, a home with a fan/TV ~0.005–0.02, a café or car ~0.02–0.06,
 * and anything above that is louder than conversation.
 */
export function classifyEnvironment(noiseFloor: number): EnvironmentClass {
  const floor = Number.isFinite(noiseFloor) ? Math.max(0, noiseFloor) : 0;
  if (floor < 0.004) return 'quiet';
  if (floor < 0.02) return 'home';
  if (floor < 0.06) return 'noisy';
  return 'loud';
}

export const ENVIRONMENT_TUNING: Record<EnvironmentClass, EnvironmentTuning> = {
  quiet: {
    env: 'quiet',
    label: 'Quiet room',
    advice: 'Listening normally — short pauses end a turn quickly.',
    endOfSpeechMs: 700,
    speechWaitFactor: 0.6,
    minConfidence: 0.25,
    holdMs: 900,
    requireOwnerVoice: false,
    ownerTolerance: 0.5,
  },
  home: {
    env: 'home',
    label: 'Home background noise',
    advice: 'Waiting a little longer before sending, so a sentence is not cut in half.',
    endOfSpeechMs: 1000,
    speechWaitFactor: 0.85,
    minConfidence: 0.3,
    holdMs: 1200,
    requireOwnerVoice: false,
    ownerTolerance: 0.5,
  },
  noisy: {
    env: 'noisy',
    label: 'Noisy surroundings',
    advice: 'Waiting longer, ignoring unclear speech, and keeping the microphone open.',
    endOfSpeechMs: 1400,
    speechWaitFactor: 1.2,
    minConfidence: 0.4,
    holdMs: 1600,
    requireOwnerVoice: false,
    ownerTolerance: 0.45,
  },
  loud: {
    env: 'loud',
    label: 'Loud surroundings',
    advice: 'Only your enrolled voice is answered here; everything else is ignored as background.',
    endOfSpeechMs: 1800,
    speechWaitFactor: 1.5,
    minConfidence: 0.5,
    holdMs: 2000,
    requireOwnerVoice: true,
    ownerTolerance: 0.4,
  },
};

export function environmentTuning(env: EnvironmentClass): EnvironmentTuning {
  return ENVIRONMENT_TUNING[env] || ENVIRONMENT_TUNING.home;
}

export interface NoiseFloorState {
  /** Exponentially smoothed floor, or null before the first sample. */
  floor: number | null;
  /** Reading count, so the first samples can be adopted quickly. */
  samples: number;
}

/**
 * Track the noise floor with asymmetric smoothing: it rises quickly (a TV is
 * switched on and the app must stop trusting the room within a second) and
 * falls slowly (a single quiet gap between words must not be mistaken for a
 * quiet room).
 */
export function updateNoiseFloor(
  state: NoiseFloorState,
  sample: number,
  opts: { riseAlpha?: number; fallAlpha?: number; adoptFirst?: number } = {},
): NoiseFloorState {
  const riseAlpha = opts.riseAlpha ?? 0.35;
  const fallAlpha = opts.fallAlpha ?? 0.04;
  const adoptFirst = opts.adoptFirst ?? 3;
  const value = Number.isFinite(sample) ? Math.max(0, sample) : 0;
  const n = state.samples + 1;
  if (state.floor == null || state.samples < adoptFirst) {
    // Average the first few readings instead of reacting to one frame.
    const prior = state.floor == null ? value : state.floor;
    const floor = state.floor == null ? value : prior + (value - prior) / n;
    return { floor, samples: n };
  }
  const alpha = value > state.floor ? riseAlpha : fallAlpha;
  return { floor: state.floor + (value - state.floor) * alpha, samples: n };
}

export function resetNoiseFloor(): NoiseFloorState {
  return { floor: null, samples: 0 };
}

/** Do the two classifications differ enough to tell the user? */
export function environmentChanged(previous: EnvironmentClass | null, next: EnvironmentClass): boolean {
  return previous !== next;
}

/**
 * In a loud room, an unenrolled voice is background by default. This is only
 * enforced when a baseline exists — without enrollment there is nothing to
 * compare against, so the app must not pretend to know who spoke.
 */
export function ownerRequiredHere(
  tuning: EnvironmentTuning,
  baselineHz: number | null,
  ownerOnly: boolean,
): boolean {
  if (ownerOnly) return baselineHz != null;
  return tuning.requireOwnerVoice && baselineHz != null;
}

/** Same band the end-of-speech setting itself accepts (700–4000 ms). */
export const SPEECH_WAIT_MIN = 700;
export const SPEECH_WAIT_MAX = 4000;

/**
 * The wait actually used for this turn: the user's setting, adapted to the
 * room. It can only be trusted inside the accepted band, and an unknown
 * setting falls back to the app default instead of guessing from NaN.
 */
export function effectiveEndOfSpeechMs(userMs: unknown, tuning: EnvironmentTuning): number {
  const base = Number(userMs);
  const value = Number.isFinite(base) && base > 0 ? base : 1600;
  return Math.min(SPEECH_WAIT_MAX, Math.max(SPEECH_WAIT_MIN, Math.round(value * tuning.speechWaitFactor)));
}
