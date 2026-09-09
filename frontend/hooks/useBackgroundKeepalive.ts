'use client';
import { useCallback, useEffect } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { resolveBgState, type BgState } from '@/lib/background';

// Best-effort background resilience. What each piece REALLY does:
//
// - visibilitychange/pageshow/freeze/resume listeners: detect the OS
//   suspending us and recover() the moment we're back. This is the part
//   that actually works everywhere.
// - Wake Lock re-request on return: keeps the screen alive again.
// - Periodic Sync registration: Android Chrome + installed PWA ONLY.
//   iOS Safari does not implement it at all — registering there is a no-op.
// - We deliberately do NOT use geolocation as a keepalive: on iOS the page
//   is suspended anyway (so it buys zero mic time), while costing battery
//   and a scary location permission. No battery tradeoff can buy what the
//   OS forbids.
export function useBackgroundKeepalive(recover: () => void) {
  const bgState = useAssistantStore((s) => s.bgState);
  const setBgState = useAssistantStore((s) => s.setBgState);

  const refresh = useCallback(() => {
    const frozen = (document as any).wasDiscarded === true;
    const state: BgState = resolveBgState({ visible: !document.hidden, frozen });
    setBgState(state);
    try {
      useAssistantStore.getState().logBgEvent(document.hidden ? 'page-hidden' : 'page-visible', frozen ? 'frozen' : undefined);
    } catch {}
    if (!document.hidden) {
      try {
        recover();
      } catch {}
    }
  }, [recover, setBgState]);

  useEffect(() => {
    const onFreeze = () => setBgState('frozen');
    const onResume = () => refresh();
    const onPageShow = () => refresh();
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('freeze', onFreeze as any);
    document.addEventListener('resume', onResume as any);
    window.addEventListener('pageshow', onPageShow);
    refresh();

    // Android-only: periodic sync keeps the SERVICE WORKER (not the mic)
    // alive longer while minimized. Guarded — throws nowhere.
    (async () => {
      try {
        const reg = await (navigator as any).serviceWorker?.ready;
        const periodic = (reg as any)?.periodicSync;
        if (periodic && typeof periodic.register === 'function') {
          const status = await (navigator as any).permissions?.query?.({ name: 'periodic-background-sync' });
          if (!status || status.state === 'granted') {
            await periodic.register('onebrain-keepalive', { minInterval: 30 * 1000 }).catch(() => {});
          }
        }
      } catch {}
    })();

    return () => {
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('freeze', onFreeze as any);
      document.removeEventListener('resume', onResume as any);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [refresh, setBgState]);

  return { bgState };
}
