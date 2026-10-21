// The locale the running app uses right now. One small module-level store so
// that pure helpers (formatting, feature replies, speech) can read it without
// importing React or the Zustand stores:
//   - store/assistant.ts calls setLocaleSettings() whenever settings change;
//   - startLocaleDetection() runs once in the browser (from the app shell);
//   - components subscribe through hooks/useLocale.ts.
// On the server, never use this — pass explicit values (see prompt.ts).

import { fetchNetworkCountry, needsNetworkCountry, readLocaleSignals } from './detect';
import { resolveLocale, type LocaleSettings, type LocaleSignals, type ResolvedLocale } from './resolve';

let settings: LocaleSettings = {};
let signals: LocaleSignals | null = null;
let current: ResolvedLocale | null = null;
let started = false;
const listeners = new Set<() => void>();

function changed(): void {
  current = null;
  for (const listener of listeners) listener();
}

/** The resolved locale for this device and these settings (memoised). */
export function activeLocale(): ResolvedLocale {
  if (!current) {
    signals ??= readLocaleSignals();
    current = resolveLocale(settings, signals);
  }
  return current;
}

/** Called by the settings store; only re-resolves when language/country change. */
export function setLocaleSettings(next: LocaleSettings): void {
  const language = next.language || undefined;
  const country = next.country || undefined;
  if (language === settings.language && country === settings.country) return;
  settings = { language, country };
  changed();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start listening for device changes and, only when the time zone does not
 * identify the country, look the country up once. Safe to call repeatedly.
 */
export function startLocaleDetection(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('languagechange', () => {
    signals = readLocaleSignals();
    changed();
  });
  const now = (signals ??= readLocaleSignals());
  if (needsNetworkCountry(now)) {
    void fetchNetworkCountry().then((country) => {
      if (!country) return;
      signals = { ...(signals ?? readLocaleSignals()), networkCountry: country };
      changed();
    });
  }
}

/**
 * Pick the wording for a built-in spoken reply: English by default, the
 * Hinglish line only for people who talk to OneBrain in Hinglish or Hindi.
 */
export function localized(english: string, hinglish: string): string {
  return activeLocale().hinglish ? hinglish : english;
}

/** Tests only: forget settings, signals and listeners. */
export function resetActiveLocaleForTests(nextSignals?: LocaleSignals, nextSettings: LocaleSettings = {}): void {
  settings = { ...nextSettings };
  signals = nextSignals ?? null;
  current = null;
  started = false;
  listeners.clear();
}
