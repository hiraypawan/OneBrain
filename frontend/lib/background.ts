// Background state machine (pure logic — the hook feeds it DOM events).
// Honest model: the OS, not the app, decides. States only describe what WE
// can observe, so the UI can say "paused by iPhone, tap to resume" instead
// of silently dying.

export type BgState = 'foreground' | 'hidden' | 'frozen';

export function resolveBgState(opts: { visible: boolean; frozen: boolean }): BgState {
  if (opts.frozen) return 'frozen';
  return opts.visible ? 'foreground' : 'hidden';
}

export interface BgEvent {
  t: number; // Date.now()
  elapsed: number; // ms since session start (0 if unknown)
  kind: string;
  detail?: string;
}

// Flight recorder: ring buffer of timestamped background/mic events.
// Lets users PROVE what happened with the screen off (mic alive? muted at
// Xs? recognition died?) instead of guessing. Pure + tested.
export function pushBgEvent(log: BgEvent[], e: Omit<BgEvent, 't'> & { t?: number }, max = 80): BgEvent[] {
  const t = e.t ?? Date.now();
  const next = [...log, { t, elapsed: e.elapsed, kind: e.kind, ...(e.detail ? { detail: e.detail } : {}) }];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function formatBgEvent(e: BgEvent): string {
  const s = (e.elapsed / 1000).toFixed(1);
  return `+${s}s ${e.kind}${e.detail ? ` (${e.detail})` : ''}`;
}

export function bgStateLabel(state: BgState, isiOS: boolean): string {
  if (state === 'foreground') return 'App open — mic live';
  if (isiOS) {
    return state === 'frozen'
      ? 'iPhone froze the page — reopen to resume.'
      : 'iPhone backgrounded: mic may keep going (watch for answers) or pause — reopen to be sure.';
  }
  return state === 'frozen'
    ? 'Page frozen — tap to resume listening.'
    : 'App in background — Android may keep listening briefly.';
}
