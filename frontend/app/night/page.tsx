'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { useAssistant } from '@/hooks/useAssistant';

// Black-screen battery mode: pure black OLED-friendly UI that holds the
// wake lock while Active runs. Open it, turn brightness down, pocket the
// phone (screen ON but black = mic keeps working; screen OFF = OS suspends).
export default function NightPage() {
  const isActive = useAssistantStore((s) => s.isActive);
  const currentStatus = useAssistantStore((s) => s.currentStatus);
  const { stopActive, recover } = useAssistant();
  const [showControls, setShowControls] = useState(false);

  const holdWake = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) await (navigator as any).wakeLock.request('screen');
    } catch {}
  }, []);

  useEffect(() => {
    holdWake();
    recover();
    const onVis = () => {
      if (!document.hidden) {
        holdWake();
        recover();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [holdWake, recover]);

  const dot =
    currentStatus === 'listening' ? 'bg-green-500' :
    currentStatus === 'speaking' ? 'bg-blue-500' :
    currentStatus === 'processing' ? 'bg-yellow-500' : 'bg-gray-600';

  return (
    <div
      className="fixed inset-0 bg-black flex flex-col items-center justify-center"
      onClick={() => setShowControls((v) => !v)}
    >
      <div className={`w-6 h-6 rounded-full ${dot} ${isActive ? 'animate-pulse' : ''}`} />
      <p className="text-gray-600 text-xs mt-4">{isActive ? currentStatus : 'not active'}</p>
      {showControls && (
        <div className="mt-8 flex flex-col gap-3 items-center" onClick={(e) => e.stopPropagation()}>
          <a href="/active" className="px-6 py-3 bg-gray-800 rounded-xl">Back to Active</a>
          {isActive && (
            <button onClick={stopActive} className="px-6 py-3 bg-red-800 rounded-xl font-bold">
              Stop
            </button>
          )}
          <p className="text-gray-600 text-xs max-w-[240px] text-center">
            Tap anywhere to hide. Screen must stay ON — locked phones suspend the mic (OS rule).
          </p>
        </div>
      )}
    </div>
  );
}
