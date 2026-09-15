// HIIT voice timer: presets -> spoken cue schedules. The runner (React side)
// speaks cues through the existing TTS engine and auto-logs the finished
// workout to the fitness timeline. Pure schedule generation + tested.

import { findAllNumbers } from './numbers';

export interface WorkoutRound {
  label: string;
  labelHi: string;
  seconds: number;
  restAfter: number; // seconds of rest after this round (0 = none)
}

export interface WorkoutPreset {
  id: string;
  name: string;
  nameHi: string;
  rounds: WorkoutRound[];
}

const SEVEN_MINUTE: WorkoutRound[] = [
  { label: 'Jumping jacks', labelHi: 'Jumping jacks', seconds: 30, restAfter: 10 },
  { label: 'Wall sit', labelHi: 'Wall sit', seconds: 30, restAfter: 10 },
  { label: 'Pushups', labelHi: 'Pushups', seconds: 30, restAfter: 10 },
  { label: 'Crunches', labelHi: 'Crunches', seconds: 30, restAfter: 10 },
  { label: 'Step-ups', labelHi: 'Step-ups', seconds: 30, restAfter: 10 },
  { label: 'Squats', labelHi: 'Squats', seconds: 30, restAfter: 10 },
  { label: 'Tricep dips', labelHi: 'Tricep dips', seconds: 30, restAfter: 10 },
  { label: 'Plank', labelHi: 'Plank', seconds: 30, restAfter: 10 },
  { label: 'High knees', labelHi: 'High knees', seconds: 30, restAfter: 10 },
  { label: 'Lunges', labelHi: 'Lunges', seconds: 30, restAfter: 10 },
  { label: 'Pushup rotation', labelHi: 'Pushup rotation', seconds: 30, restAfter: 10 },
  { label: 'Side plank', labelHi: 'Side plank', seconds: 30, restAfter: 0 },
];

const TABATA: WorkoutRound[] = Array.from({ length: 8 }, (_, i) => ({
  label: `Tabata round ${i + 1}`,
  labelHi: `Tabata round ${i + 1}`,
  seconds: 20,
  restAfter: i === 7 ? 0 : 10,
}));

export const PRESETS: WorkoutPreset[] = [
  { id: 'seven-minute', name: '7-Minute Workout', nameHi: '7 minute workout', rounds: SEVEN_MINUTE },
  { id: 'tabata', name: 'Tabata 20/10 × 8', nameHi: 'Tabata', rounds: TABATA },
  {
    id: 'desi-express',
    name: 'Desi Express × 3',
    nameHi: 'Desi express',
    rounds: [
      { label: 'Baithaks (squats)', labelHi: 'Baithak', seconds: 40, restAfter: 20 },
      { label: 'Dands (pushups)', labelHi: 'Dand', seconds: 40, restAfter: 20 },
      { label: 'Spot jogging', labelHi: 'Spot jogging', seconds: 40, restAfter: 20 },
      { label: 'Baithaks (squats)', labelHi: 'Baithak', seconds: 40, restAfter: 20 },
      { label: 'Dands (pushups)', labelHi: 'Dand', seconds: 40, restAfter: 20 },
      { label: 'Spot jogging', labelHi: 'Spot jogging', seconds: 40, restAfter: 0 },
    ],
  },
];

export function customPreset(workSec: number, restSec: number, rounds: number, label = 'Work'): WorkoutPreset | null {
  if (![workSec, restSec, rounds].every((n) => Number.isFinite(n) && n > 0)) return null;
  if (workSec > 600 || restSec > 300 || rounds > 30) return null;
  return {
    id: `custom-${workSec}-${restSec}-${rounds}`,
    name: `Custom ${workSec}/${restSec} × ${rounds}`,
    nameHi: 'Custom workout',
    rounds: Array.from({ length: rounds }, (_, i) => ({
      label: rounds > 1 ? `${label} ${i + 1}` : label,
      labelHi: label,
      seconds: workSec,
      restAfter: i === rounds - 1 ? 0 : restSec,
    })),
  };
}

export type WorkoutIntent =
  | { kind: 'preset'; id: string }
  | { kind: 'custom'; workSec: number; restSec: number; rounds: number }
  | { kind: 'control'; action: 'pause' | 'resume' | 'skip' | 'stop' | 'status' }
  | null;

/** "7 minute workout shuru karo" / "tabata" / "30 sec on 10 off 10 rounds". */
export function detectWorkoutIntent(text: string): WorkoutIntent {
  const t = String(text || '').toLowerCase();
  if (/(pause|rok do|ruk jao|hold).*(workout|timer|exercise)/.test(t) || t.trim() === 'pause workout')
    return { kind: 'control', action: 'pause' };
  if (/(resume|continue|phir se|chalu karo).*(workout|timer|exercise)/.test(t) || t.trim() === 'resume workout')
    return { kind: 'control', action: 'resume' };
  if (/(skip|agli|next).*(round|exercise|workout)/.test(t) || t.trim() === 'skip')
    return { kind: 'control', action: 'skip' };
  if (/(stop|band karo|khatam|finish).*(workout|timer|exercise)/.test(t) || /^(stop workout|workout band)$/.test(t.trim()))
    return { kind: 'control', action: 'stop' };
  if (!/(workout|tabata|hiit|timer|exercise|kasrat|shuru karo|start|rounds?|sets?|sec(ond)?s?|rest)/.test(t)) return null;
  if (/tabata/.test(t)) return { kind: 'preset', id: 'tabata' };
  if (/desi|dand|baithak/.test(t)) return { kind: 'preset', id: 'desi-express' };
  if (/(7|seven|saat).*(minute|min)/.test(t) || /seven.minute/.test(t))
    return { kind: 'preset', id: 'seven-minute' };
  // Custom: "30 sec on 10 off 10 rounds" / "40 second kaam 20 aaram 5 round"
  const nums = findAllNumbers(t);
  if (/(round|set|repeat)/.test(t) && nums.length >= 3) {
    const [workSec, restSec, rounds] = nums;
    if (workSec <= 600 && restSec <= 300 && rounds <= 30)
      return { kind: 'custom', workSec, restSec, rounds };
  }
  if (/(workout|timer|hiit).*(shuru|start|karo|begin)/.test(t))
    return { kind: 'preset', id: 'seven-minute' };
  return null;
}

export interface Cue {
  atSec: number; // elapsed seconds when this must be spoken
  text: string;
  kind: 'start' | 'go' | 'half' | 'countdown' | 'rest' | 'done';
}

export interface CueSchedule {
  cues: Cue[];
  totalSec: number;
}

/** Precompute every spoken cue. Countdowns only for rounds >= 10s. */
export function buildCues(preset: WorkoutPreset): CueSchedule {
  const cues: Cue[] = [];
  let at = 0;
  cues.push({ atSec: 0, text: `${preset.name}. Taiyaar? 3, 2, 1, GO!`, kind: 'start' });
  preset.rounds.forEach((r, i) => {
    const last = i === preset.rounds.length - 1;
    if (i > 0) {
      cues.push({
        atSec: at,
        text: `Next: ${r.label}! 3, 2, 1, GO!`,
        kind: 'go',
      });
    } else {
      cues.push({ atSec: at, text: `${r.label}! GO!`, kind: 'go' });
    }
    if (r.seconds >= 20) {
      cues.push({ atSec: at + Math.floor(r.seconds / 2), text: 'Halfway! Keep going!', kind: 'half' });
    }
    if (r.seconds >= 10) {
      cues.push({ atSec: at + r.seconds - 3, text: '3, 2, 1!', kind: 'countdown' });
    }
    at += r.seconds;
    if (r.restAfter > 0) {
      cues.push({ atSec: at, text: `Rest. ${r.restAfter} seconds.`, kind: 'rest' });
      at += r.restAfter;
    } else if (!last) {
      cues.push({ atSec: at, text: 'Done! Next up!', kind: 'rest' });
    }
  });
  cues.push({ atSec: at, text: 'Workout complete! Kya baat hai! Logging it to your fitness timeline.', kind: 'done' });
  return { cues: cues.sort((a, b) => a.atSec - b.atSec), totalSec: at };
}

export function presetById(id: string): WorkoutPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function formatClock(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${`${s}`.padStart(2, '0')}`;
}
