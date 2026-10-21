// The languages OneBrain can listen and talk in. One entry ties together the
// three things that must agree for a voice turn to work:
//   recognition — the tag given to the browser's SpeechRecognition
//   tts         — the tag used to pick the spoken voice (and its accent)
//   reply       — the language the model is told to answer in
// The `id` is what Settings stores. Old ids (en-IN, hinglish, marathi, …) stay
// valid forever so saved preferences keep working. Pure data, no DOM.

import { ENGLISH_VARIANTS, type EnglishVariant } from './countries';

export type ReplyLanguage =
  | 'english' | 'hinglish' | 'hindi' | 'marathi'
  | 'spanish' | 'french' | 'german' | 'italian' | 'portuguese' | 'dutch'
  | 'swedish' | 'danish' | 'norwegian' | 'finnish' | 'polish' | 'turkish'
  | 'japanese' | 'korean' | 'chinese' | 'arabic';

export interface VoiceLanguage {
  /** Value stored in settings.language. */
  id: string;
  /** Name shown in English, e.g. "English (UK)". */
  label: string;
  /** The language's own name when it differs, e.g. "Deutsch". */
  native?: string;
  /** BCP-47 tag for SpeechRecognition.lang. */
  recognition: string;
  /** BCP-47 tag for the spoken voice (browser voice + read-aloud accent). */
  tts: string;
  reply: ReplyLanguage;
}

/** Settings value meaning "follow the device language and country". */
export const AUTO_LANGUAGE = 'auto';

const english = (id: EnglishVariant, label: string): VoiceLanguage =>
  ({ id, label, recognition: id, tts: id, reply: 'english' });

export const VOICE_LANGUAGES: readonly VoiceLanguage[] = [
  english('en-US', 'English (US)'),
  english('en-GB', 'English (UK)'),
  english('en-AU', 'English (Australia)'),
  english('en-CA', 'English (Canada)'),
  english('en-IE', 'English (Ireland)'),
  english('en-NZ', 'English (New Zealand)'),
  english('en-ZA', 'English (South Africa)'),
  english('en-SG', 'English (Singapore)'),
  english('en-IN', 'English (India)'),
  // Hinglish: the Hindi recognizer copes with mixed Hindi + English speech;
  // replies are Roman-script, which an Indian English voice reads best.
  { id: 'hinglish', label: 'Hinglish (Hindi + English)', recognition: 'hi-IN', tts: 'en-IN', reply: 'hinglish' },
  { id: 'hi-IN', label: 'Hindi', native: 'हिन्दी', recognition: 'hi-IN', tts: 'hi-IN', reply: 'hindi' },
  { id: 'marathi', label: 'Marathi', native: 'मराठी', recognition: 'mr-IN', tts: 'mr-IN', reply: 'marathi' },
  { id: 'es-ES', label: 'Spanish (Spain)', native: 'Español (España)', recognition: 'es-ES', tts: 'es-ES', reply: 'spanish' },
  { id: 'es-MX', label: 'Spanish (Latin America)', native: 'Español (Latinoamérica)', recognition: 'es-MX', tts: 'es-MX', reply: 'spanish' },
  { id: 'es-US', label: 'Spanish (US)', native: 'Español (EE. UU.)', recognition: 'es-US', tts: 'es-US', reply: 'spanish' },
  { id: 'fr-FR', label: 'French (France)', native: 'Français (France)', recognition: 'fr-FR', tts: 'fr-FR', reply: 'french' },
  { id: 'fr-CA', label: 'French (Canada)', native: 'Français (Canada)', recognition: 'fr-CA', tts: 'fr-CA', reply: 'french' },
  { id: 'de-DE', label: 'German', native: 'Deutsch', recognition: 'de-DE', tts: 'de-DE', reply: 'german' },
  { id: 'it-IT', label: 'Italian', native: 'Italiano', recognition: 'it-IT', tts: 'it-IT', reply: 'italian' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)', recognition: 'pt-BR', tts: 'pt-BR', reply: 'portuguese' },
  { id: 'pt-PT', label: 'Portuguese (Portugal)', native: 'Português (Portugal)', recognition: 'pt-PT', tts: 'pt-PT', reply: 'portuguese' },
  { id: 'nl-NL', label: 'Dutch', native: 'Nederlands', recognition: 'nl-NL', tts: 'nl-NL', reply: 'dutch' },
  { id: 'sv-SE', label: 'Swedish', native: 'Svenska', recognition: 'sv-SE', tts: 'sv-SE', reply: 'swedish' },
  { id: 'da-DK', label: 'Danish', native: 'Dansk', recognition: 'da-DK', tts: 'da-DK', reply: 'danish' },
  { id: 'nb-NO', label: 'Norwegian', native: 'Norsk', recognition: 'nb-NO', tts: 'nb-NO', reply: 'norwegian' },
  { id: 'fi-FI', label: 'Finnish', native: 'Suomi', recognition: 'fi-FI', tts: 'fi-FI', reply: 'finnish' },
  { id: 'pl-PL', label: 'Polish', native: 'Polski', recognition: 'pl-PL', tts: 'pl-PL', reply: 'polish' },
  { id: 'tr-TR', label: 'Turkish', native: 'Türkçe', recognition: 'tr-TR', tts: 'tr-TR', reply: 'turkish' },
  { id: 'ja-JP', label: 'Japanese', native: '日本語', recognition: 'ja-JP', tts: 'ja-JP', reply: 'japanese' },
  { id: 'ko-KR', label: 'Korean', native: '한국어', recognition: 'ko-KR', tts: 'ko-KR', reply: 'korean' },
  { id: 'zh-CN', label: 'Chinese (Mandarin)', native: '中文（普通话）', recognition: 'zh-CN', tts: 'zh-CN', reply: 'chinese' },
  { id: 'zh-TW', label: 'Chinese (Taiwan)', native: '中文（台灣）', recognition: 'zh-TW', tts: 'zh-TW', reply: 'chinese' },
  { id: 'ar-SA', label: 'Arabic', native: 'العربية', recognition: 'ar-SA', tts: 'ar-SA', reply: 'arabic' },
];

const BY_ID: ReadonlyMap<string, VoiceLanguage> = new Map(VOICE_LANGUAGES.map((v) => [v.id, v]));

export function voiceLanguageById(id: string | null | undefined): VoiceLanguage | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** True for every value settings.language may hold. */
export function isLanguageSetting(value: unknown): value is string {
  return value === AUTO_LANGUAGE || (typeof value === 'string' && BY_ID.has(value));
}

/** "English (UK)" or "Deutsch — German": how a picker should show an entry. */
export function voiceLanguageLabel(v: VoiceLanguage): string {
  return v.native ? `${v.native} — ${v.label}` : v.label;
}

// Base language -> which catalog entry to use for a country (first match wins),
// for browsers that report a bare or unlisted region ("es", "es-AR", "pt").
const REGIONAL_DEFAULTS: Record<string, Array<[countries: string[] | '*', id: string]>> = {
  es: [[['US'], 'es-US'], [['MX', 'AR', 'CL', 'CO', 'PE'], 'es-MX'], ['*', 'es-ES']],
  fr: [[['CA'], 'fr-CA'], ['*', 'fr-FR']],
  pt: [[['PT'], 'pt-PT'], ['*', 'pt-BR']],
  zh: [[['TW', 'HK'], 'zh-TW'], ['*', 'zh-CN']],
  de: [['*', 'de-DE']], it: [['*', 'it-IT']], nl: [['*', 'nl-NL']], sv: [['*', 'sv-SE']],
  da: [['*', 'da-DK']], nb: [['*', 'nb-NO']], no: [['*', 'nb-NO']], nn: [['*', 'nb-NO']],
  fi: [['*', 'fi-FI']], pl: [['*', 'pl-PL']], tr: [['*', 'tr-TR']], ja: [['*', 'ja-JP']],
  ko: [['*', 'ko-KR']], ar: [['*', 'ar-SA']], hi: [['*', 'hi-IN']], mr: [['*', 'marathi']],
};

/** The English variant for a browser tag such as "en-GB"; undefined for bare "en" or other regions. */
export function englishVariantOf(tag: string | null | undefined): EnglishVariant | undefined {
  const [base = '', region = ''] = String(tag || '').split(/[-_]/);
  if (base.toLowerCase() !== 'en' || !region) return undefined;
  const candidate = `en-${region.toUpperCase()}` as EnglishVariant;
  return ENGLISH_VARIANTS.includes(candidate) ? candidate : undefined;
}

/**
 * Which voice language to use.
 * - An explicit setting always wins.
 * - "auto": the device's *primary* language decides. English stays English
 *   (with the accent passed in, which comes from the country); a supported
 *   non-English language is used as is; anything else falls back to English,
 *   because English is the product's primary language.
 */
export function resolveVoiceLanguage(
  setting: string | null | undefined,
  languages: readonly string[],
  englishVariant: EnglishVariant,
  country: string | null,
): VoiceLanguage {
  const explicit = setting && setting !== AUTO_LANGUAGE ? voiceLanguageById(setting) : undefined;
  if (explicit) return explicit;
  const englishEntry = voiceLanguageById(englishVariant) ?? VOICE_LANGUAGES[0];
  const primary = String(languages[0] || '').replace(/_/g, '-');
  const [rawBase = ''] = primary.split('-');
  const base = rawBase.toLowerCase();
  if (!base || base === 'en') return englishEntry;
  // Exact catalog match first ("es-MX", "fr-CA", "zh-TW").
  const parts = primary.split('-');
  const region = parts.slice(1).find((p) => /^[a-z]{2}$/i.test(p))?.toUpperCase();
  const script = parts.slice(1).find((p) => /^[a-z]{4}$/i.test(p))?.toLowerCase();
  if (base === 'zh' && script === 'hant') return voiceLanguageById('zh-TW')!;
  const exact = region ? voiceLanguageById(`${base}-${region}`) : undefined;
  if (exact) return exact;
  const rules = REGIONAL_DEFAULTS[base];
  if (!rules) return englishEntry;
  const where = region || country || '';
  for (const [countries, id] of rules) {
    if (countries === '*' || countries.includes(where)) return voiceLanguageById(id) ?? englishEntry;
  }
  return englishEntry;
}
