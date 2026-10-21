// Locale: where the user is and how they talk. See lib/README.md.
//   countries.ts        country facts (English variant, currency, units, crisis line) + time zone lookup
//   voice-languages.ts  the languages OneBrain listens/talks in + "auto" resolution
//   resolve.ts          settings + device signals -> ResolvedLocale (pure)
//   detect.ts           reads device signals in the browser (+ optional /api/geo)
//   active.ts           the app's current locale (client), localized() for spoken replies
//   format.ts           dates, times, money in the user's conventions
//   text-language.ts    which language a piece of text is in (script + common words)
// Server code should import the pure files directly (countries, voice-languages, resolve).

export * from './countries';
export * from './voice-languages';
export * from './resolve';
export * from './format';
export * from './text-language';
export { activeLocale, localized, setLocaleSettings, startLocaleDetection, subscribeLocale } from './active';
