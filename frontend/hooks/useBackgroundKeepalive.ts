"use client";
import { useCallback, useEffect } from "react";
import { useAssistantStore } from "@/store/assistant";
import { resolveBgState, type BgState } from "@/lib/background";

// Best-effort resume detection, not a guarantee of background microphone access.
// Periodic background sync cannot keep a microphone or a page alive.
export function useBackgroundKeepalive(recover: () => void | Promise<void>) {
  const bgState = useAssistantStore((s) => s.bgState);
  const setBgState = useAssistantStore((s) => s.setBgState);

  const refresh = useCallback(() => {
    const frozen = false; // wasDiscarded describes a previous document, not this page’s current state.
    const state: BgState = resolveBgState({
      visible: !document.hidden,
      frozen,
    });
    setBgState(state);
    try {
      useAssistantStore
        .getState()
        .logBgEvent(
          document.hidden ? "page-hidden" : "page-visible",
          frozen ? "frozen" : undefined,
        );
    } catch {}
    if (!document.hidden) {
      try {
        void Promise.resolve(recover()).catch(() => {});
      } catch {}
    }
  }, [recover, setBgState]);

  useEffect(() => {
    const onFreeze = () => setBgState("frozen");
    const onResume = () => refresh();
    const onPageShow = () => refresh();
    document.addEventListener("visibilitychange", refresh);
    document.addEventListener("freeze", onFreeze as any);
    document.addEventListener("resume", onResume as any);
    window.addEventListener("pageshow", onPageShow);
    refresh();

    // Remove obsolete registrations from older installations; do not schedule empty wake-ups.
    void navigator.serviceWorker
      ?.getRegistration()
      .then(async (reg) => {
        await (reg as any)?.periodicSync?.unregister("onebrain-keepalive");
      })
      .catch(() => {});

    return () => {
      document.removeEventListener("visibilitychange", refresh);
      document.removeEventListener("freeze", onFreeze as any);
      document.removeEventListener("resume", onResume as any);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [refresh, setBgState]);

  return { bgState };
}
