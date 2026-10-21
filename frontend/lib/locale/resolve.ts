// Settings + device signals -> one ResolvedLocale that the rest of the app
// reads (voice, prompt, formatting, crisis lines). Pure: every input is passed
// in, so this runs the same in the browser, on the server and in tests.

import {
  countryFromLanguages, countryFromTimeZone, countryInfo, normalizeCountry,
  type CountryInfo, type EnglishVariant, type Units,
} from './countries';
import { englishVariantOf, resolveVoiceLanguage, type VoiceLanguage } from './voice-languages';

/** The user's explicit choices; empty / "auto" means detect. */
export interface LocaleSettings {
  language?: string;
  country?: string;
}

/** What the device tells us, gathered by detect.ts (or given by tests). */
export interface LocaleSignals {
  /** IANA zone from Intl, e.g. "Europe/London"; null when unknown. */
  timeZone: string | null;
  /** navigator.languages, most preferred first. */
  languages: readonly string[];
  /** Country from the network (Cloudflare's CF-IPCountry), when fetched. */
  networkCountry: string | null;
}

export type CountrySource = 'setting' | 'timezone' | 'network' | 'language' | 'none';

export interface ResolvedLocale {
  /** ISO 3166-1 alpha-2, or null when nothing reliable was found. */
  country: string | null;
  countrySource: CountrySource;
  info: CountryInfo | null;
  timeZone: string | null;
  /** The English the app speaks, spells and formats in. */
  english: EnglishVariant;
  voice: VoiceLanguage;
  /** True when the voice language came from "auto" rather than a choice. */
  voiceAuto: boolean;
  /** Intl locale for dates, times and money inside (English) replies. */
  formatLocale: EnglishVariant;
  currency: string;
  units: Units;
  /** India-specific speech helpers apply (station names, Hinglish fixes). */
  indian: boolean;
  /** Built-in spoken replies use Hinglish wording instead of English. */
  hinglish: boolean;
}

/** Where the user is: explicit choice, then time zone, then network, then browser region. */
export function resolveCountry(
  settings: LocaleSettings,
  signals: LocaleSignals,
): { country: string | null; source: CountrySource } {
  const chosen = normalizeCountry(settings.country);
  if (chosen) return { country: chosen, source: 'setting' };
  const fromZone = countryFromTimeZone(signals.timeZone);
  if (fromZone) return { country: fromZone, source: 'timezone' };
  const fromNetwork = normalizeCountry(signals.networkCountry);
  if (fromNetwork) return { country: fromNetwork, source: 'network' };
  const fromLanguage = countryFromLanguages(signals.languages);
  if (fromLanguage) return { country: fromLanguage, source: 'language' };
  return { country: null, source: 'none' };
}

const INDIAN_VOICES = new Set(['en-IN', 'hinglish', 'hi-IN', 'marathi']);

export function resolveLocale(settings: LocaleSettings, signals: LocaleSignals): ResolvedLocale {
  const { country, source } = resolveCountry(settings, signals);
  const info = countryInfo(country) ?? null;
  // The accent follows the country: an Indian user's browser often says
  // "en-US" or "en-GB" only because nobody changed it, but their speech is
  // Indian English. With no country, a deliberate browser region is next.
  const english: EnglishVariant =
    info?.english ?? signals.languages.map(englishVariantOf).find(Boolean) ?? 'en-US';
  const voice = resolveVoiceLanguage(settings.language, signals.languages, english, country);
  const voiceEnglish = voice.reply === 'english' ? (voice.id as EnglishVariant) : english;
  return {
    country,
    countrySource: source,
    info,
    timeZone: signals.timeZone,
    // A user who picked "English (UK)" gets British spelling and formats too.
    english: voiceEnglish,
    voice,
    voiceAuto: !settings.language || settings.language === 'auto' || voice.id !== settings.language,
    formatLocale: voiceEnglish,
    currency: info?.currency ?? 'USD',
    units: info?.units ?? (voiceEnglish === 'en-US' ? 'us' : 'metric'),
    indian: country === 'IN' || INDIAN_VOICES.has(voice.id),
    hinglish: voice.reply === 'hinglish' || voice.reply === 'hindi' || voice.reply === 'marathi',
  };
}
