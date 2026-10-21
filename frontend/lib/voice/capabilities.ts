// What this device and browser can do for voice, and how to fix it when it
// cannot. Every message names the exact place to tap on *this* platform
// (iPhone Safari, Android Chrome, Mac Safari, Windows Edge…) instead of
// generic advice. Pure: pass a navigator-like object in tests.

export type Os = 'ios' | 'android' | 'mac' | 'windows' | 'chromeos' | 'linux' | 'other';
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'opera' | 'other';

export interface Platform {
  os: Os;
  browser: Browser;
  /** Facebook/Instagram/LinkedIn/Android WebView in-app browsers: no reliable mic. */
  inApp: boolean;
}

interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
}

export function detectPlatform(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): Platform {
  const ua = String(nav?.userAgent || '');
  // iPadOS reports a Mac user agent; touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
  const os: Os = ios ? 'ios'
    : /Android/.test(ua) ? 'android'
    : /CrOS/.test(ua) ? 'chromeos'
    : /Windows/.test(ua) ? 'windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'mac'
    : /Linux/.test(ua) ? 'linux'
    : 'other';
  const browser: Browser = /Edg(e|A|iOS)?\//.test(ua) ? 'edge'
    : /SamsungBrowser/.test(ua) ? 'samsung'
    : /OPR\/|Opera/.test(ua) ? 'opera'
    : /Firefox|FxiOS/.test(ua) ? 'firefox'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'chrome'
    : /Safari/.test(ua) ? 'safari'
    : 'other';
  const inApp = /FBAN|FBAV|Instagram|LinkedInApp|Snapchat|Line\/|; wv\)/.test(ua);
  return { os, browser, inApp };
}

export interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
  microphone: boolean;
}

export function speechSupport(win: unknown = typeof window === 'undefined' ? undefined : window): SpeechSupport {
  const w = (win || {}) as Record<string, unknown> & { navigator?: { mediaDevices?: { getUserMedia?: unknown } } };
  return {
    recognition: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition),
    synthesis: Boolean(w.speechSynthesis),
    microphone: typeof w.navigator?.mediaDevices?.getUserMedia === 'function',
  };
}

const BROWSER_NAME: Record<Browser, string> = {
  safari: 'Safari', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', samsung: 'Samsung Internet', opera: 'Opera', other: 'your browser',
};

/**
 * Why talking will not work here, or null when it should. Shown before the
 * user tries, so nobody taps the mic and gets silence.
 */
export function voiceInputNotice(platform: Platform, support: SpeechSupport): string | null {
  if (platform.inApp) {
    return platform.os === 'ios'
      ? 'This in-app browser blocks the microphone. Tap ⋯ or the share icon → “Open in Safari” to talk to OneBrain.'
      : 'This in-app browser blocks the microphone. Tap ⋮ → “Open in Chrome” to talk to OneBrain.';
  }
  if (!support.recognition) {
    if (platform.browser === 'firefox') {
      return 'Firefox does not support speech recognition yet. You can type below, or open OneBrain in Chrome, Edge or Safari to talk.';
    }
    return `${BROWSER_NAME[platform.browser] === 'your browser' ? 'This browser' : BROWSER_NAME[platform.browser]} cannot recognise speech. You can type below, or open OneBrain in Chrome, Edge or Safari to talk.`;
  }
  if (!support.microphone) return 'The microphone is unavailable here. Open OneBrain over HTTPS in Chrome, Edge or Safari to talk.';
  return null;
}

/** Exactly where to re-allow the microphone on this platform. */
export function micPermissionHelp(platform: Platform): string {
  const reload = ' Then reload the page.';
  switch (platform.os) {
    case 'ios':
      return platform.browser === 'safari' || platform.browser === 'other'
        ? `Microphone blocked. Tap “aA” in the address bar → Website Settings → Microphone → Allow.${reload}`
        : `Microphone blocked. Open the iPhone Settings app → ${BROWSER_NAME[platform.browser]} → turn on Microphone.${reload}`;
    case 'android':
      return `Microphone blocked. Tap the icon left of the address → Permissions → Microphone → Allow.${reload}`;
    case 'mac':
      return platform.browser === 'safari'
        ? `Microphone blocked. In the menu bar choose Safari → Settings for This Website → Microphone → Allow. Also check System Settings → Privacy & Security → Microphone.${reload}`
        : `Microphone blocked. Click the icon left of the address bar → Microphone → Allow. Also check System Settings → Privacy & Security → Microphone → ${BROWSER_NAME[platform.browser]}.${reload}`;
    case 'windows':
      return `Microphone blocked. Click the icon left of the address bar → Microphone → Allow. Also check Windows Settings → Privacy & security → Microphone.${reload}`;
    default:
      return `Microphone blocked. Click the icon left of the address bar → Microphone → Allow.${reload}`;
  }
}

/** The mic is held by something else (a call, another tab, a paired laptop). */
export function micBusyHelp(platform: Platform): string {
  return platform.os === 'ios' || platform.os === 'android'
    ? 'The microphone is busy — a call or another app is using it. Close it and tap Active again.'
    : 'The microphone is busy — another app, tab or a connected headset is using it. Close it and click Active again.';
}
