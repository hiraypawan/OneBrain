'use client';
// The device clock, for text that depends on it ("Good evening",
// "Wednesday · 21 October", what counts as "today").
//
// Why a hook: pages are prerendered at build time, on a server in another
// time zone and language. If clock-dependent text is in the server HTML, the
// browser's first render disagrees with it — React reports a hydration error
// and throws the server HTML away — and the page shows the build day's
// greeting until then. So useNow() is null in the server HTML and during
// hydration, and the device time immediately afterwards. Render a
// placeholder for null (see TodayView).
//
// It also keeps time moving: one shared timer refreshes it every minute, and
// coming back to the app refreshes it at once, so a tab left open overnight
// moves on to the new day.

import { useMemo, useSyncExternalStore } from 'react';

const MINUTE = 60_000;
const listeners = new Set<() => void>();
let current: number | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  current = Date.now();
  for (const listener of listeners) listener();
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') tick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(tick, MINUTE);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/**
 * Stable within a render (React calls this more than once and requires the
 * same answer), fresh for a screen that mounts after time has passed with
 * nobody subscribed; while subscribed, the timer moves it on.
 */
function getSnapshot(): number {
  const now = Date.now();
  if (current === null || (listeners.size === 0 && now - current >= MINUTE)) current = now;
  return current;
}

const getServerSnapshot = (): null => null;

/** The device time, or null in the server HTML and while hydrating. */
export function useNow(): Date | null {
  const time = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => (time === null ? null : new Date(time)), [time]);
}

/** Tests only: the store behind the hook, and a way to forget it. */
export const clockStoreForTests = {
  subscribe,
  getSnapshot,
  reset(): void {
    clearInterval(timer);
    timer = undefined;
    current = null;
    listeners.clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  },
};
