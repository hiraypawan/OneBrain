'use client';
import { useEffect, useState } from 'react';

// Install banner: native prompt on Android/Chrome, manual steps on iOS.
// Dismissal remembered so it never nags twice.
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem('onebrain-install-dismissed')) return;
    } catch {}
    setDismissed(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (isiOS && !standalone) setShowIOS(true);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem('onebrain-install-dismissed', '1');
    } catch {}
    setDismissed(true);
  };

  if (!deferred && !showIOS) return null;

  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="mt-3 p-3 bg-gray-900 border border-gray-700 rounded-xl text-sm flex items-center justify-between gap-3">
        <span>
          {deferred
            ? '📲 Install OneBrain for fullscreen + offline mode.'
            : '📲 iPhone: Share → Add to Home Screen for the app icon.'}
        </span>
        <div className="flex gap-2 shrink-0">
          {deferred && (
            <button
              onClick={async () => {
                try {
                  await deferred.prompt();
                } catch {}
                dismiss();
              }}
              className="px-4 py-2 bg-green-700 rounded-lg font-bold"
            >
              Install
            </button>
          )}
          <button onClick={dismiss} className="px-3 py-2 text-gray-400">
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
