// Test devices for lib/locale. The active locale normally reads the machine's
// time zone and browser languages; tests must not depend on where they run.
import { resetActiveLocaleForTests } from '@/lib/locale/active';
import type { LocaleSettings, LocaleSignals } from '@/lib/locale/resolve';

export const INDIA: LocaleSignals = { timeZone: 'Asia/Kolkata', languages: ['en-IN', 'hi-IN'], networkCountry: null };
export const US: LocaleSignals = { timeZone: 'America/New_York', languages: ['en-US'], networkCountry: null };
export const UK: LocaleSignals = { timeZone: 'Europe/London', languages: ['en-GB'], networkCountry: null };
export const AUSTRALIA: LocaleSignals = { timeZone: 'Australia/Sydney', languages: ['en-AU'], networkCountry: null };
export const GERMANY: LocaleSignals = { timeZone: 'Europe/Berlin', languages: ['de-DE', 'en'], networkCountry: null };

/** Every test file starts on this device (see setup-locale.ts). */
export const DEFAULT_TEST_DEVICE = INDIA;

/** Pretend to be on `signals` with `settings` (e.g. { language: 'hinglish' }) until the next call. */
export function useDevice(signals: LocaleSignals, settings: LocaleSettings = {}): void {
  resetActiveLocaleForTests(signals, settings);
}

/** A Hinglish speaker in India: built-in replies use Hinglish wording. */
export function useHinglishSpeaker(): void {
  useDevice(INDIA, { language: 'hinglish' });
}
