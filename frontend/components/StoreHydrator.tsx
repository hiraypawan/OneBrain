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
    useAssistantStore.getState().hydrate().then(async () => {
      if (!alive) return;
      const revision = useAssistantStore.getState().authRevision;
      // Legacy bearer tokens never restore identity or trigger automatic uploads.
      setToken(null);
      if (shouldRestoreSession(document.cookie,location.pathname,location.search)) try {
        const me = await platformApi('/me');
        if (alive && revision === useAssistantStore.getState().authRevision) useAssistantStore.getState().loginBackend(me.user);
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
