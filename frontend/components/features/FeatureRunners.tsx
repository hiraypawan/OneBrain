'use client';
import { useEffect, useRef } from 'react';
import { useFeaturesStore } from '@/store/features';

/**
 * Speaks workout cues on schedule and auto-logs the finished workout.
 * Mount once (on Today). Timer math derives from store fields so voice
 * controls (pause/skip/stop) and UI stay consistent.
 */
export function WorkoutRunner() {
  const lastElapsed = useRef(0);
  const speaking = useRef(false);
  const finishing = useRef(false);
  const runId = useRef('');

  useEffect(() => {
    const timer = setInterval(() => {
      const f = useFeaturesStore.getState();
      const run = f.workout;
      const speaker = f.speaker;
      if (!run || run.finished || run.pausedAt || !speaker) {
        if (run && runId.current !== `${run.startedAt}`) {
          runId.current = `${run.startedAt}`;
          finishing.current = false;
        }
        if (run) {
          const e = Math.max(0, (Date.now() - run.startedAt - run.pausedAccum - (run.pausedAt ? Date.now() - run.pausedAt : 0)) / 1000);
          lastElapsed.current = e;
        }
        return;
      }
      if (runId.current !== `${run.startedAt}`) {
        runId.current = `${run.startedAt}`;
        finishing.current = false;
        lastElapsed.current = Math.max(0, (Date.now() - run.startedAt - run.pausedAccum) / 1000);
      }
      const elapsed = Math.max(0, (Date.now() - run.startedAt - run.pausedAccum) / 1000);
      const due = run.schedule.cues.filter((c) => c.atSec > lastElapsed.current - 0.5 && c.atSec <= elapsed);
      lastElapsed.current = elapsed;
      if (due.length && !speaking.current) {
        speaking.current = true;
        void (async () => {
          for (const cue of due) {
            try {
              await useFeaturesStore.getState().speaker?.(cue.text);
            } catch { /* keep the timer going */ }
            const cur = useFeaturesStore.getState().workout;
            if (!cur || cur.pausedAt || `${cur.startedAt}` !== runId.current) break;
          }
          speaking.current = false;
        })();
      }
      if (elapsed >= run.schedule.totalSec + 1 && !finishing.current) {
        finishing.current = true;
        const mins = Math.max(1, Math.round(run.schedule.totalSec / 60));
        f.logFitness(
          { kind: 'workout', label: `${run.preset.name} (${run.preset.rounds.length} rounds)`, qty: mins, unit: 'mins' },
          'workout',
        );
        f.setWorkout({ ...run, finished: true });
      }
    }, 300);
    return () => clearInterval(timer);
  }, []);

  return null;
}

/**
 * Witness check-in loop: asks "sab theek?" on interval, counts misses,
 * raises the alert phase after two misses. Mount once (on Today).
 */
export function WitnessRunner() {
  const askedAt = useRef<number | null>(null);
  const alerted = useRef(false);
  const lastCheckin = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const f = useFeaturesStore.getState();
      const w = f.witness;
      const speaker = f.speaker;
      if (w.phase === 'idle') {
        askedAt.current = null;
        alerted.current = false;
        lastCheckin.current = null;
        return;
      }
      if (w.lastCheckinAt !== lastCheckin.current) {
        lastCheckin.current = w.lastCheckinAt;
        askedAt.current = null;
        if (w.phase === 'active') alerted.current = false;
      }
      if (w.phase === 'alert') {
        if (!alerted.current && speaker) {
          alerted.current = true;
          void speaker('Alert! Aapne do baar jawab nahi diya. Agar safe ho to bolo safe, warna SMS alert bhejo.').catch(() => {});
          try {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate([300, 200, 300]);
          } catch { /* noop */ }
        }
        return;
      }
      if (!w.lastCheckinAt || !speaker) return;
      const since = (Date.now() - w.lastCheckinAt) / 1000;
      if (since >= w.intervalSec && askedAt.current === null) {
        askedAt.current = Date.now();
        f.witnessDispatch({ type: 'checkin-due', at: Date.now() });
        void speaker('Sab theek? Bolo safe.').catch(() => {});
      } else if (askedAt.current !== null && Date.now() - askedAt.current > 60000) {
        askedAt.current = null;
        f.witnessDispatch({ type: 'missed', at: Date.now() });
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  return null;
}
