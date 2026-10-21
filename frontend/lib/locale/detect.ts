// Reads the device's locale signals in the browser. Nothing here asks the
// user for permission or sends anything beyond one optional request:
//   1. Intl time zone       — set by the phone/OS, unaffected by VPNs.
//   2. navigator.languages  — the languages the user prefers.
//   3. /api/geo             — the country of the network (Cloudflare adds it),
//      fetched only when the time zone does not identify a country (UTC,
//      privacy browsers, rare zones), and cached for a week.

import { countryFromTimeZone, normalizeCountry } from './countries';
import type { LocaleSignals } from './resolve';

const GEO_CACHE_KEY = 'onebrain-geo';
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEO_TIMEOUT_MS = 3_000;

/** The device time zone, or null when the runtime cannot tell. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone ? zone : null;
  } catch {
    return null;
  }
}

/** The browser's preferred languages, most preferred first. */
export function deviceLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  const list = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : navigator.language ? [navigator.language] : [];
  return list.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0).slice(0, 8);
}

/** Last network country we saw, if it is less than a week old. */
export function cachedNetworkCountry(now = Date.now()): string | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { country?: unknown; at?: unknown };
    if (typeof saved.at !== 'number' || now - saved.at > GEO_TTL_MS) return null;
    return normalizeCountry(saved.country);
  } catch {
    return null;
  }
}

export function readLocaleSignals(): LocaleSignals {
  return { timeZone: deviceTimeZone(), languages: deviceLanguages(), networkCountry: cachedNetworkCountry() };
}

/** Whether a network lookup could add anything: the time zone names no country and nothing is cached. */
export function needsNetworkCountry(signals: LocaleSignals): boolean {
  return !countryFromTimeZone(signals.timeZone) && !signals.networkCountry;
}

/**
 * Ask our own /api/geo route for the network country and cache it. Returns
 * null on any failure; the app then simply uses the remaining signals.
 */
export async function fetchNetworkCountry(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('/api/geo', {
      cache: 'no-store',
      signal: AbortSignal.timeout(GEO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { country?: unknown };
    const country = normalizeCountry(body.country);
    try {
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ country, at: Date.now() }));
    } catch { /* storage full or blocked: the lookup just repeats next visit */ }
    return country;
  } catch {
    return null;
  }
}
