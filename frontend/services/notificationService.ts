// Persistent "AI Active" notifications: the only lifeline when the page is
// hidden on Android. SW path (prod) supports Stop/Open actions; the
// `new Notification` fallback (dev/desktop) has no actions by platform rule.
let fallbackNote: Notification | null = null;

export function isAndroid() {
  return typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export async function showActiveNotification(): Promise<boolean> {
  const title = 'OneBrain Active';
  try {
    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (reg) {
        await (reg as any).showNotification(title, {
          body: 'Voice session started. Open to check microphone status; Stop ends the session.',
          icon: '/icon-192.png',
          tag: 'onebrain-active',
          requireInteraction: true,
          actions: [
            { action: 'stop', title: 'Stop' },
            { action: 'open', title: 'Open' },
          ],
        });
        return true;
      }
    }
  } catch {}
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      fallbackNote = new Notification(title, {
        body: 'Voice session started. Open the app to check microphone status.',
        icon: '/icon-192.png',
        tag: 'onebrain-active',
      });
      return true;
    }
  } catch {}
  return false;
}

export async function dismissActiveNotification() {
  try {
    fallbackNote?.close();
  } catch {}
  fallbackNote = null;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const notes = await reg.getNotifications({ tag: 'onebrain-active' });
      notes.forEach((n) => n.close());
    }
  } catch {}
}

export async function showReminderNotification(title: string, body: string) {
  const { fireReminderNotification } = await import('@/lib/reminders');
  return fireReminderNotification(title, body);
}
