// Country facts the assistant adapts to: which English it speaks, the money,
// the units, and who to call in a crisis. Pure data + lookups, no DOM.
//
// Scope: English-speaking markets first, then the other high-income and large
// markets the product targets. A country missing from this table still works:
// the app falls back to US English, US dollars and a generic crisis message.
//
// Safety: `helpline` and `emergency` are only filled in where the number is
// well established. Where unsure we leave them out on purpose — the crisis
// reply then points to findahelpline.com and "your local emergency number"
// instead of risking a wrong number.

/** English variants the app speaks, spells and formats in (BCP-47). */
export type EnglishVariant =
  | 'en-US' | 'en-GB' | 'en-AU' | 'en-CA' | 'en-IN' | 'en-IE' | 'en-NZ' | 'en-ZA' | 'en-SG';

export const ENGLISH_VARIANTS: readonly EnglishVariant[] = [
  'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'en-IE', 'en-NZ', 'en-ZA', 'en-SG',
];

/** us = °F, miles, pounds; uk = °C with miles/mph on the road; metric = °C, km, kg. */
export type Units = 'us' | 'uk' | 'metric';

export interface Helpline {
  /** Service name as people know it, e.g. "Samaritans". */
  name: string;
  /** What to dial or text, written the way it is advertised. */
  contact: string;
}

export interface CountryInfo {
  name: string;
  english: EnglishVariant;
  /** ISO 4217 code. */
  currency: string;
  units: Units;
  /** Emergency number for an ambulance, when well established. */
  emergency?: string;
  /** Free crisis / suicide-prevention line, when well established. */
  helpline?: Helpline;
}

const EU_EMERGENCY = '112';

export const COUNTRIES: Readonly<Record<string, CountryInfo>> = {
  // English-speaking markets
  US: { name: 'United States', english: 'en-US', currency: 'USD', units: 'us', emergency: '911',
    helpline: { name: 'the 988 Suicide & Crisis Lifeline', contact: 'call or text 988' } },
  CA: { name: 'Canada', english: 'en-CA', currency: 'CAD', units: 'metric', emergency: '911',
    helpline: { name: 'the 9-8-8 Suicide Crisis Helpline', contact: 'call or text 988' } },
  GB: { name: 'United Kingdom', english: 'en-GB', currency: 'GBP', units: 'uk', emergency: '999',
    helpline: { name: 'Samaritans', contact: 'call 116 123, free, any time' } },
  IE: { name: 'Ireland', english: 'en-IE', currency: 'EUR', units: 'metric', emergency: '112',
    helpline: { name: 'Samaritans', contact: 'call 116 123, free, any time' } },
  AU: { name: 'Australia', english: 'en-AU', currency: 'AUD', units: 'metric', emergency: '000',
    helpline: { name: 'Lifeline', contact: 'call 13 11 14' } },
  NZ: { name: 'New Zealand', english: 'en-NZ', currency: 'NZD', units: 'metric', emergency: '111',
    helpline: { name: 'Need to talk?', contact: 'call or text 1737' } },
  ZA: { name: 'South Africa', english: 'en-ZA', currency: 'ZAR', units: 'metric', emergency: '112',
    helpline: { name: 'the SADAG Suicide Crisis Helpline', contact: 'call 0800 567 567' } },
  SG: { name: 'Singapore', english: 'en-SG', currency: 'SGD', units: 'metric', emergency: '995',
    helpline: { name: 'Samaritans of Singapore', contact: 'call 1767, any time' } },
  IN: { name: 'India', english: 'en-IN', currency: 'INR', units: 'metric', emergency: '112',
    helpline: { name: 'Tele-MANAS', contact: 'call 14416, free, 24x7' } },
  NG: { name: 'Nigeria', english: 'en-GB', currency: 'NGN', units: 'metric', emergency: '112' },
  KE: { name: 'Kenya', english: 'en-GB', currency: 'KES', units: 'metric', emergency: '999' },
  GH: { name: 'Ghana', english: 'en-GB', currency: 'GHS', units: 'metric', emergency: '112' },
  PH: { name: 'Philippines', english: 'en-US', currency: 'PHP', units: 'metric', emergency: '911' },
  PK: { name: 'Pakistan', english: 'en-GB', currency: 'PKR', units: 'metric' },
  BD: { name: 'Bangladesh', english: 'en-GB', currency: 'BDT', units: 'metric', emergency: '999' },
  LK: { name: 'Sri Lanka', english: 'en-GB', currency: 'LKR', units: 'metric' },
  NP: { name: 'Nepal', english: 'en-GB', currency: 'NPR', units: 'metric' },
  MY: { name: 'Malaysia', english: 'en-GB', currency: 'MYR', units: 'metric', emergency: '999' },
  HK: { name: 'Hong Kong', english: 'en-GB', currency: 'HKD', units: 'metric', emergency: '999' },

  // Europe
  DE: { name: 'Germany', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY,
    helpline: { name: 'TelefonSeelsorge', contact: 'call 0800 111 0 111, free, any time' } },
  AT: { name: 'Austria', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  CH: { name: 'Switzerland', english: 'en-GB', currency: 'CHF', units: 'metric', emergency: EU_EMERGENCY },
  FR: { name: 'France', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY,
    helpline: { name: 'the national suicide prevention line', contact: 'call 3114, free, any time' } },
  BE: { name: 'Belgium', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  NL: { name: 'Netherlands', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY,
    helpline: { name: '113 Suicide Prevention', contact: 'call 113 or 0800 0113' } },
  LU: { name: 'Luxembourg', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  DK: { name: 'Denmark', english: 'en-GB', currency: 'DKK', units: 'metric', emergency: EU_EMERGENCY },
  SE: { name: 'Sweden', english: 'en-GB', currency: 'SEK', units: 'metric', emergency: EU_EMERGENCY },
  NO: { name: 'Norway', english: 'en-GB', currency: 'NOK', units: 'metric', emergency: EU_EMERGENCY },
  FI: { name: 'Finland', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  IS: { name: 'Iceland', english: 'en-GB', currency: 'ISK', units: 'metric', emergency: EU_EMERGENCY },
  ES: { name: 'Spain', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY,
    helpline: { name: 'the 024 suicide prevention line', contact: 'call 024, free, any time' } },
  PT: { name: 'Portugal', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  IT: { name: 'Italy', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  PL: { name: 'Poland', english: 'en-GB', currency: 'PLN', units: 'metric', emergency: EU_EMERGENCY },
  CZ: { name: 'Czechia', english: 'en-GB', currency: 'CZK', units: 'metric', emergency: EU_EMERGENCY },
  GR: { name: 'Greece', english: 'en-GB', currency: 'EUR', units: 'metric', emergency: EU_EMERGENCY },
  TR: { name: 'Türkiye', english: 'en-GB', currency: 'TRY', units: 'metric', emergency: EU_EMERGENCY },

  // Middle East
  AE: { name: 'United Arab Emirates', english: 'en-GB', currency: 'AED', units: 'metric', emergency: '999' },
  SA: { name: 'Saudi Arabia', english: 'en-GB', currency: 'SAR', units: 'metric' },
  QA: { name: 'Qatar', english: 'en-GB', currency: 'QAR', units: 'metric', emergency: '999' },
  IL: { name: 'Israel', english: 'en-US', currency: 'ILS', units: 'metric', emergency: '101' },
  EG: { name: 'Egypt', english: 'en-GB', currency: 'EGP', units: 'metric' },

  // Asia-Pacific
  JP: { name: 'Japan', english: 'en-US', currency: 'JPY', units: 'metric', emergency: '119' },
  KR: { name: 'South Korea', english: 'en-US', currency: 'KRW', units: 'metric', emergency: '119',
    helpline: { name: 'the suicide prevention line', contact: 'call 109, any time' } },
  CN: { name: 'China', english: 'en-US', currency: 'CNY', units: 'metric', emergency: '120' },
  TW: { name: 'Taiwan', english: 'en-US', currency: 'TWD', units: 'metric', emergency: '119' },
  ID: { name: 'Indonesia', english: 'en-US', currency: 'IDR', units: 'metric', emergency: '112' },
  TH: { name: 'Thailand', english: 'en-US', currency: 'THB', units: 'metric' },
  VN: { name: 'Vietnam', english: 'en-US', currency: 'VND', units: 'metric' },

  // Latin America
  MX: { name: 'Mexico', english: 'en-US', currency: 'MXN', units: 'metric', emergency: '911' },
  BR: { name: 'Brazil', english: 'en-US', currency: 'BRL', units: 'metric' },
  AR: { name: 'Argentina', english: 'en-US', currency: 'ARS', units: 'metric' },
  CL: { name: 'Chile', english: 'en-US', currency: 'CLP', units: 'metric' },
  CO: { name: 'Colombia', english: 'en-US', currency: 'COP', units: 'metric', emergency: '123' },
  PE: { name: 'Peru', english: 'en-US', currency: 'PEN', units: 'metric' },
};

/** Country facts for an ISO 3166-1 alpha-2 code (any case); undefined when unknown. */
export function countryInfo(code: string | null | undefined): CountryInfo | undefined {
  if (!code) return undefined;
  const key = String(code).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRIES, key) ? COUNTRIES[key] : undefined;
}

/** A two-letter code we know, normalised to upper case; null otherwise. */
export function normalizeCountry(code: unknown): string | null {
  if (typeof code !== 'string' || !/^[a-z]{2}$/i.test(code.trim())) return null;
  const key = code.trim().toUpperCase();
  return countryInfo(key) ? key : null;
}

// ---------------------------------------------------------------------------
// Time zone -> country. The device time zone is the most dependable location
// signal a page has without asking: phones set it from the network, and VPNs
// do not change it. Exact names first, then whole-region prefixes.
// ---------------------------------------------------------------------------

const ZONES: Record<string, string[]> = {
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
    'America/Anchorage', 'America/Detroit', 'America/Boise', 'America/Juneau', 'America/Sitka', 'America/Nome',
    'America/Yakutat', 'America/Metlakatla', 'America/Adak', 'America/Menominee', 'America/Indianapolis',
    'America/Louisville', 'America/Fort_Wayne', 'Pacific/Honolulu', 'US/Eastern', 'US/Central', 'US/Mountain',
    'US/Pacific', 'US/Hawaii', 'US/Alaska', 'US/Arizona', 'US/Michigan'],
  CA: ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax',
    'America/St_Johns', 'America/Regina', 'America/Montreal', 'America/Moncton', 'America/Glace_Bay',
    'America/Goose_Bay', 'America/Whitehorse', 'America/Dawson', 'America/Dawson_Creek', 'America/Fort_Nelson',
    'America/Yellowknife', 'America/Inuvik', 'America/Iqaluit', 'America/Rankin_Inlet', 'America/Resolute',
    'America/Cambridge_Bay', 'America/Swift_Current', 'America/Atikokan', 'America/Creston',
    'America/Blanc-Sablon', 'America/Nipigon', 'America/Thunder_Bay', 'America/Rainy_River', 'America/Pangnirtung'],
  MX: ['America/Mexico_City', 'America/Cancun', 'America/Merida', 'America/Monterrey', 'America/Matamoros',
    'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Mazatlan', 'America/Bahia_Banderas',
    'America/Hermosillo', 'America/Tijuana'],
  BR: ['America/Sao_Paulo', 'America/Rio_Branco', 'America/Manaus', 'America/Belem', 'America/Fortaleza',
    'America/Recife', 'America/Bahia', 'America/Cuiaba', 'America/Campo_Grande', 'America/Porto_Velho',
    'America/Boa_Vista', 'America/Maceio', 'America/Araguaina', 'America/Santarem', 'America/Noronha',
    'America/Eirunepe'],
  AR: ['America/Buenos_Aires', 'America/Cordoba', 'America/Mendoza'],
  CL: ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'],
  CO: ['America/Bogota'],
  PE: ['America/Lima'],
  GB: ['Europe/London', 'Europe/Belfast', 'GB'],
  IE: ['Europe/Dublin', 'Eire'],
  DE: ['Europe/Berlin', 'Europe/Busingen'],
  AT: ['Europe/Vienna'],
  CH: ['Europe/Zurich'],
  FR: ['Europe/Paris'],
  BE: ['Europe/Brussels'],
  NL: ['Europe/Amsterdam'],
  LU: ['Europe/Luxembourg'],
  DK: ['Europe/Copenhagen'],
  SE: ['Europe/Stockholm'],
  NO: ['Europe/Oslo'],
  FI: ['Europe/Helsinki'],
  IS: ['Atlantic/Reykjavik', 'Iceland'],
  ES: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'],
  PT: ['Europe/Lisbon', 'Atlantic/Azores', 'Atlantic/Madeira', 'Portugal'],
  IT: ['Europe/Rome'],
  PL: ['Europe/Warsaw', 'Poland'],
  CZ: ['Europe/Prague'],
  GR: ['Europe/Athens'],
  TR: ['Europe/Istanbul', 'Asia/Istanbul', 'Turkey'],
  IN: ['Asia/Kolkata', 'Asia/Calcutta'],
  PK: ['Asia/Karachi'],
  BD: ['Asia/Dhaka', 'Asia/Dacca'],
  LK: ['Asia/Colombo'],
  NP: ['Asia/Kathmandu', 'Asia/Katmandu'],
  SG: ['Asia/Singapore', 'Singapore'],
  MY: ['Asia/Kuala_Lumpur', 'Asia/Kuching'],
  ID: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Pontianak'],
  TH: ['Asia/Bangkok'],
  VN: ['Asia/Ho_Chi_Minh', 'Asia/Saigon'],
  PH: ['Asia/Manila'],
  HK: ['Asia/Hong_Kong', 'Hongkong'],
  TW: ['Asia/Taipei', 'ROC'],
  CN: ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'PRC'],
  JP: ['Asia/Tokyo', 'Japan'],
  KR: ['Asia/Seoul', 'ROK'],
  AE: ['Asia/Dubai'],
  SA: ['Asia/Riyadh'],
  QA: ['Asia/Qatar'],
  IL: ['Asia/Jerusalem', 'Asia/Tel_Aviv', 'Israel'],
  EG: ['Africa/Cairo', 'Egypt'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham', 'NZ'],
  ZA: ['Africa/Johannesburg'],
  NG: ['Africa/Lagos'],
  KE: ['Africa/Nairobi'],
  GH: ['Africa/Accra'],
};

const ZONE_PREFIXES: Array<[string, string]> = [
  ['America/Indiana/', 'US'], ['America/Kentucky/', 'US'], ['America/North_Dakota/', 'US'],
  ['America/Argentina/', 'AR'], ['Australia/', 'AU'], ['Canada/', 'CA'], ['Brazil/', 'BR'], ['Mexico/', 'MX'],
];

const ZONE_TO_COUNTRY: ReadonlyMap<string, string> = new Map(
  Object.entries(ZONES).flatMap(([country, zones]) => zones.map((zone) => [zone, country] as [string, string])),
);

/** Country for an IANA time zone; null for UTC, unknown or shared zones. */
export function countryFromTimeZone(timeZone: string | null | undefined): string | null {
  if (!timeZone) return null;
  const exact = ZONE_TO_COUNTRY.get(timeZone);
  if (exact) return exact;
  for (const [prefix, country] of ZONE_PREFIXES) if (timeZone.startsWith(prefix)) return country;
  return null;
}

/** Country from the region of the first browser language that has one ("en-GB" -> GB). */
export function countryFromLanguages(languages: readonly string[]): string | null {
  for (const tag of languages) {
    const region = String(tag || '').split(/[-_]/).slice(1).find((part) => /^[a-z]{2}$/i.test(part));
    const known = normalizeCountry(region);
    if (known) return known;
  }
  return null;
}

/**
 * Currencies the app offers in pickers and accepts in records: every country's
 * own currency above, plus the common international ones. The Workers API
 * accepts any real ISO 4217 code, so this list can grow freely.
 */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  ...new Set(['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', ...Object.values(COUNTRIES).map((c) => c.currency)]),
];

const CURRENCY_SET: ReadonlySet<string> = new Set(SUPPORTED_CURRENCIES);

export function isSupportedCurrency(code: unknown): code is string {
  return typeof code === 'string' && CURRENCY_SET.has(code);
}

/** Short picker list: the user's own currency first, then the most used ones (and `current`, if set). */
export function currencyChoices(own: string, current?: string): string[] {
  const common = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'NZD', 'SGD', 'JPY', 'ZAR', 'AED', 'CHF'];
  return [...new Set([own, ...(current && isSupportedCurrency(current) ? [current] : []), ...common])];
}
