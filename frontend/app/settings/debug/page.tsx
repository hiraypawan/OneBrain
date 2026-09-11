'use client';
import { useEffect, useState } from 'react';
import { useAssistantStore } from '@/store/assistant';
import { formatBgEvent } from '@/lib/background';
import { db } from '@/lib/db';

export default function Debug() {
  const [info, setInfo] = useState<any>({});
  const [counts, setCounts] = useState<any>({});
  const bgLog = useAssistantStore((s) => s.bgLog);
  const sessionStart = useAssistantStore((s) => s.sessionStart);

  const refresh = async () => {
    const base: any = {
      build: process.env.NEXT_PUBLIC_BUILD_ID || 'dev',
      userAgent: navigator.userAgent,
      online: navigator.onLine,
      mediaSession: 'mediaSession' in navigator,
      wakeLock: 'wakeLock' in navigator,
      serviceWorker: 'serviceWorker' in navigator,
      speechRecognition: !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition,
      speechSynthesis: 'speechSynthesis' in window,
      notifications: 'Notification' in window ? Notification.permission : 'unsupported',
      secureContext: window.isSecureContext,
    };
    try {
      const perm = await (navigator as any).permissions?.query({ name: 'microphone' });
      base.micPermission = perm?.state || 'unknown';
    } catch {
      base.micPermission = 'unknown';
    }
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      base.swRegistered = !!reg;
      base.swScope = reg?.scope || null;
    } catch {
      base.swRegistered = false;
    }
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      base.audioInputs = devices?.filter((d) => d.kind === 'audioinput').map((d) => d.label || '(unnamed)') || [];
      base.audioOutputs = devices?.filter((d) => d.kind === 'audiooutput').map((d) => d.label || '(unnamed)') || [];
    } catch {
      base.audioInputs = 'blocked';
    }
    try {
      base.pageErrors = (window as any).__onebrain_errors || [];
      base.storedErrors = JSON.parse(localStorage.getItem('onebrain-errors') || '[]');
    } catch {
      base.pageErrors = 'unavailable';
    }
    setInfo(base);
    try {
      setCounts({
        conversations: await db.conversations.count(),
        messages: await db.messages.count(),
        reminders: await db.reminders.count(),
        gems: (process.env.NEXT_PUBLIC_API_URL ? 'backend configured' : 'local only'),
      });
    } catch {
      setCounts({ indexedDB: 'unavailable' });
    }
  };

  useEffect(() => {
    refresh();
    const onNet = () => refresh();
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    return () => {
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
    };
  }, []);

  return (
    <div className="py-6">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">Debug</h1>
        <button onClick={refresh} className="px-3 py-1 bg-gray-800 rounded text-sm">Refresh</button>
      </div>
      <pre className="text-xs bg-gray-900 p-4 rounded overflow-auto">{JSON.stringify({ ...info, storage: counts }, null, 2)}</pre>
      <h2 className="text-lg font-bold mt-6 mb-2">Background session log</h2>
      <p className="text-xs text-gray-400 mb-2">
        {sessionStart
          ? `Session started ${new Date(sessionStart).toLocaleTimeString()}. Lock the screen / minimize, talk, come back — this log proves what the mic did.`
          : 'Press Active first — events appear here with timestamps.'}
      </p>
      <pre className="text-xs bg-gray-900 p-4 rounded overflow-auto max-h-64">
        {bgLog.length ? bgLog.map(formatBgEvent).join('\n') : '(empty)'}
      </pre>
    </div>
  );
}
