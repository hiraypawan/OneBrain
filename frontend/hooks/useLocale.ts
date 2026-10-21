'use client';
import { useSyncExternalStore } from 'react';
import { activeLocale, subscribeLocale } from '@/lib/locale/active';
import { resolveLocale, type ResolvedLocale } from '@/lib/locale/resolve';

// Server render and the first client render must match, so before hydration
// every component sees the same neutral locale; the real one follows at once.
const SERVER_LOCALE: ResolvedLocale = resolveLocale({}, { timeZone: null, languages: [], networkCountry: null });

/** The user's resolved locale; re-renders when settings or device signals change. */
export function useLocale(): ResolvedLocale {
  return useSyncExternalStore(subscribeLocale, activeLocale, () => SERVER_LOCALE);
}
