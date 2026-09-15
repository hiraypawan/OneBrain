'use client';
import { useEffect } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { dueReminders, markFired, fireReminderNotification } from '@/lib/reminders';
import { setToken } from '@/lib/sync';
import { shouldRestoreSession } from '@/lib/session-hint';
import { platformApi } from '@/lib/platform';
import { db } from '@/lib/db';

// Loads persisted key + settings AFTER mount, so server HTML and the first
// client render are identical (no hydration errors), then state fills in.
// Also: restores backend session, runs the reminder watchdog + cloud sync.
export function StoreHydrator() {
  useEffect(() => {
    let alive = true;
    // Feature store (plan, fitness, stories, commitments) loads alongside.
    try {
      void import('@/store/features').then((m) => m.useFeaturesStore.getState().load());
    } catch { /* features stay session-only */ }
    useAssistantStore.getState().hydrate().then(async () => {
      if (!alive) return;
      const revision = useAssistantStore.getState().authRevision;
      // Legacy bearer tokens never restore identity or trigger automatic uploads.
      setToken(null);
      if (shouldRestoreSession(document.cookie,location.pathname,location.search)) try {
        const me = await platformApi('/me');
        if (alive && revision === useAssistantStore.getState().authRevision) {
          useAssistantStore.getState().loginBackend(me.user);
          // /me already carries the plan (identity + plan, one read), so the
          // server plan is applied here for free. Counted usage deliberately
          // does NOT trigger a second request: it arrives with /bootstrap when
          // Connected work opens, and from /entitlements when the Plan panel is
          // opened. See the capacity contract in e2e/capacity.spec.ts.
          if (me.entitlement) {
            const features = await import('@/store/features');
            if (alive && revision === useAssistantStore.getState().authRevision) {
              features.useFeaturesStore.getState().applyServerEntitlement(me.entitlement);
            }
          }
        }
      } catch { /* A late failed request must not undo a newer login. */ }
      if (!alive) return;
      // Weekly storage janitor (skipped when memory is paused).
      try {
        const st = useAssistantStore.getState();
        if (!st.settings.memoryEnabled) return;
        const last = Number((await db.kv.get('lastJanitor'))?.value || 0);
        if (Date.now() - last < 7 * 86400000) return;
        const { janitor } = await import('@/lib/janitor');
        const report = await janitor({ autoDeleteDays: st.settings.autoDeleteDays });
        await db.kv.put({ key: 'lastJanitor', value: Date.now() });
        if (report.pruned > 0) await useAssistantStore.getState().reloadFromDb();
      } catch {}
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Sign-out hard-clears the server plan, so a shared device never inherits the
  // previous account's features. Signing in does NOT fetch anything: the plan
  // rides on the /me and /bootstrap responses this app already makes, and an
  // extra request per sign-in would break the documented request budget for
  // opening Connected work (bootstrap + first record page, nothing else).
  useEffect(
    () =>
      useAssistantStore.subscribe((state, previous) => {
        if (state.isAuthenticated || state.isAuthenticated === previous.isAuthenticated) return;
        void import('@/store/features')
          .then((m) => m.useFeaturesStore.getState().clearServerEntitlement())
          .catch(() => { /* nothing cached to clear */ });
      }),
    [],
  );

  useEffect(() => {
    let stopped = false;
    let ticking = false;
    const tick = async () => {
      if (stopped || ticking) return;
      ticking = true;
      // NOTE: intentionally runs while hidden too (throttled to ~1/min by the
      // browser) so reminders still fire when the tab is in the background.
      try {
        const st = useAssistantStore.getState();
        const due = dueReminders(st.reminders, new Date());
        for (const r of due) {
          // Mark fired first (never nag-loop), then try to show it.
          if (stopped) break;
          await st.updateReminder(r.id, markFired(r));
          const shown = await fireReminderNotification(r.title, r.date ? `${r.date} ${r.time}` : `Daily at ${r.time}`);
          if (!shown) {
            st.setMicNotice(`Reminder: ${r.title} (${r.time}) — allow notifications to get alerts while away.`);
          }
        }
      } catch {
        if (!stopped) useAssistantStore.getState().setMicNotice('Reminder storage is unavailable. Check your reminders; delivery was not confirmed.');
      } finally { ticking = false; }
    };
    const timer = setInterval(tick, 20000);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return null;
}
