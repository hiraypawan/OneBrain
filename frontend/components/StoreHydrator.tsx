'use client';
import { useEffect } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { dueReminders, markFired, fireReminderNotification } from '@/lib/reminders';
import { getToken, fetchMe, syncNow } from '@/lib/sync';
import { db } from '@/lib/db';

// Loads persisted key + settings AFTER mount, so server HTML and the first
// client render are identical (no hydration errors), then state fills in.
// Also: restores backend session, runs the reminder watchdog + cloud sync.
export function StoreHydrator() {
  useEffect(() => {
    useAssistantStore.getState().hydrate().then(async () => {
      // Backend session restore (needs token from a previous backend login).
      if (getToken()) {
        const me = await fetchMe();
        if (me) {
          useAssistantStore.getState().loginBackend(me);
          syncNow().catch(() => {});
        }
      }
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
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      // NOTE: intentionally runs while hidden too (throttled to ~1/min by the
      // browser) so reminders still fire when the tab is in the background.
      try {
        const st = useAssistantStore.getState();
        const due = dueReminders(st.reminders, new Date());
        for (const r of due) {
          // Mark fired first (never nag-loop), then try to show it.
          st.updateReminder(r.id, markFired(r));
          const shown = await fireReminderNotification(r.title, r.date ? `${r.date} ${r.time}` : `Daily at ${r.time}`);
          if (!shown) {
            st.setMicNotice(`Reminder: ${r.title} (${r.time}) — allow notifications to get alerts while away.`);
          }
        }
      } catch {}
    };
    const timer = setInterval(tick, 20000);
    tick();
    // Cloud sync every 5 minutes (only with a backend token, online, visible).
    const syncTimer = setInterval(() => {
      if (document.hidden || !navigator.onLine || !getToken()) return;
      syncNow().catch(() => {});
    }, 5 * 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(syncTimer);
    };
  }, []);

  return null;
}
