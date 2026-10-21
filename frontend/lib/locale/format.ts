// Dates, times and money in the user's own conventions ("21 October" in the
// UK, "October 21" in the US, £ / $ / € / ₹ by country). Every helper takes
// an optional explicit locale so pure code and tests stay deterministic; in
// the browser it defaults to the active locale.

import { activeLocale } from './active';
import type { ResolvedLocale } from './resolve';

type DateInput = Date | number | string;

const toDate = (value: DateInput): Date => (value instanceof Date ? value : new Date(value));

/** Intl date/time formatting with the user's locale. Invalid dates give ''. */
export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
  locale: Pick<ResolvedLocale, 'formatLocale'> = activeLocale(),
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale.formatLocale, options).format(date);
  } catch {
    return date.toDateString();
  }
}

/** "3:45 pm" / "15:45", following the locale's clock. */
export function formatTime(value: DateInput, locale: Pick<ResolvedLocale, 'formatLocale'> = activeLocale()): string {
  return formatDate(value, { hour: 'numeric', minute: '2-digit' }, locale);
}

/** Short date + time, e.g. for "sources as of …" lines. */
export function formatDateTime(value: DateInput, locale: Pick<ResolvedLocale, 'formatLocale'> = activeLocale()): string {
  return formatDate(value, { dateStyle: 'medium', timeStyle: 'short' }, locale);
}

/**
 * Money with the right symbol and grouping: "£1,234.50", "$20", "₹1,23,456".
 * Whole amounts drop the decimals; others keep two.
 */
export function formatMoney(
  amount: number,
  currency?: string,
  locale: Pick<ResolvedLocale, 'formatLocale' | 'currency'> = activeLocale(),
): string {
  const code = (currency || locale.currency || 'USD').toUpperCase();
  const value = Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
  const digits = value % 1 === 0 ? 0 : 2;
  // INR keeps lakh grouping for everyone ("₹1,23,456"): that is how the amount is read.
  const tag = code === 'INR' ? 'en-IN' : locale.formatLocale;
  try {
    return new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(digits)}`;
  }
}

/** Currencies written with a plain "$" / "Rs" locally. */
const DOLLAR_CURRENCIES = new Set(['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD']);
const RUPEE_CURRENCIES = new Set(['INR', 'PKR', 'LKR', 'NPR']);

/**
 * Which currency a spoken/typed amount is in. "$" means the local dollar for
 * an Australian or Canadian user; with no marker at all it is the user's own
 * currency.
 */
export function currencyFromText(text: string, fallback: string = activeLocale().currency): string {
  const t = String(text || '').toLowerCase();
  if (/₹|\binr\b/.test(t)) return 'INR';
  if (/\brs\.?\s*\d|\brupees?\b/.test(t)) return RUPEE_CURRENCIES.has(fallback) ? fallback : 'INR';
  if (/£|\bgbp\b|\bquid\b/.test(t)) return 'GBP';
  if (/€|\beur\b|\beuros?\b/.test(t)) return 'EUR';
  if (/\baud\b|\ba\$/.test(t)) return 'AUD';
  if (/\bcad\b|\bc\$/.test(t)) return 'CAD';
  if (/\bnzd\b/.test(t)) return 'NZD';
  if (/\bsgd\b|\bs\$/.test(t)) return 'SGD';
  if (/¥|\bjpy\b|\byen\b/.test(t)) return 'JPY';
  if (/\$|\busd\b|\bdollars?\b|\bbucks\b/.test(t)) return DOLLAR_CURRENCIES.has(fallback) ? fallback : 'USD';
  if (/\bpounds?\b/.test(t)) return 'GBP';
  return fallback;
}

/** Regex source matching a currency marker before an amount (for parsers). */
export const CURRENCY_PREFIX = String.raw`(?:₹|£|€|¥|[acs]?\$|\brs\.?|\binr\b|\busd\b|\bgbp\b|\beur\b|\baud\b|\bcad\b|\bnzd\b|\bsgd\b)`;

const KG_PER_LB = 0.45359237;

/** Whether this user weighs things in pounds (US) rather than kilograms. */
export function usesPounds(locale: Pick<ResolvedLocale, 'units'> = activeLocale()): boolean {
  return locale.units === 'us';
}

/** Kilograms -> pounds, one decimal. */
export const kgToLb = (kg: number): number => Math.round((kg / KG_PER_LB) * 10) / 10;
/** Pounds -> kilograms, one decimal (weights are stored in kg). */
export const lbToKg = (lb: number): number => Math.round(lb * KG_PER_LB * 10) / 10;

/** A stored weight (kg) in the user's unit: "81.6 kg" or "180 lb". */
export function formatWeight(kg: number, locale: Pick<ResolvedLocale, 'units'> = activeLocale()): string {
  if (!Number.isFinite(kg)) return '';
  return usesPounds(locale) ? `${Math.round(kgToLb(kg))} lb` : `${Math.round(kg * 10) / 10} kg`;
}

/** A weight change (kg) in the user's unit, signed: "+1.2 kg" / "-3 lb". */
export function formatWeightChange(kgDelta: number, locale: Pick<ResolvedLocale, 'units'> = activeLocale()): string {
  const value = usesPounds(locale) ? Math.round(kgToLb(kgDelta) * 10) / 10 : Math.round(kgDelta * 10) / 10;
  return `${value > 0 ? '+' : ''}${value} ${usesPounds(locale) ? 'lb' : 'kg'}`;
}
