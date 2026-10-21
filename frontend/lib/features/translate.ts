// Live translator mode: continuous speech -> translated speech.
// Pair selection + strict translation prompts + offline phrasebook for the
// most common travel/market lines. AI does open translation when online.

export type Lang = 'hi' | 'en' | 'mr';

export interface LangPair {
  id: string;
  a: Lang;
  b: Lang;
  label: string;
}

export const LANG_NAMES: Record<Lang, string> = {
  hi: 'Hindi',
  en: 'English',
  mr: 'Marathi',
};

export const PAIRS: LangPair[] = [
  { id: 'hi-en', a: 'hi', b: 'en', label: 'Hindi ⇄ English' },
  { id: 'mr-en', a: 'mr', b: 'en', label: 'Marathi ⇄ English' },
  { id: 'hi-mr', a: 'hi', b: 'mr', label: 'Hindi ⇄ Marathi' },
];

export function pairById(id: string): LangPair {
  return PAIRS.find((p) => p.id === id) || PAIRS[0];
}

export function detectLang(text: string): Lang {
  const t = String(text || '');
  if (/[\u0900-\u097F]/.test(t)) {
    // Marathi markers in Devanagari.
    if (/(aahe|ahet|nahi ka|kasa|kashi|kuthe|mala|tumhala|aapan)/i.test(t)) return 'mr';
    return 'hi';
  }
  // Roman Marathi markers (checked before Hinglish: distinct verb/noun forms).
  if (/\b(aahe|ahet|aahes|aahet|aahot|kuthe|kuthun|kutha|kasa|kashi|kase|kiti|tula|tumhala|mala|mazha|maza|mazi|tujha|tujhi|kay challay|barobar|nako|pahije|hota|hoti|zala|zali)\b/i.test(t)) return 'mr';
  // Roman Hinglish markers — the translator's main real-world input.
  if (/\b(yeh|hai|hain|kya|kaise|kitne|kitna|kitni|kahan|kidhar|kaun|kisne|mera|mere|meri|humara|mujhe|mujhko|tumhe|tumhara|tumhari|aapko|nahi|nahin|matlab|wala|wali|bahut|bohot|thoda|zyada|achha|acha|theek|sahi|galat|batao|dikhao|suno|dekho|karo|chahiye|padega|sakta|sakti|raha|rahi|rahe|gaya|gayi|kiya|liya|diya|namaste|namaskar|shukriya|dhanyavad|madad|paani|khana|bhookh|samajh|dheere|sasta|mehnga)\b/i.test(t)) return 'hi';
  return 'en';
}

export type TranslatorIntent =
  | { action: 'enter' }
  | { action: 'exit' }
  | { action: 'swap' }
  | { action: 'pair'; id: string }
  | null;

export function detectTranslatorIntent(text: string): TranslatorIntent {
  const t = String(text || '').toLowerCase().trim();
  if (/^(translator (mode )?(band|off|stop|exit)|translation band|stop translating|bas translation)/.test(t))
    return { action: 'exit' };
  if (/^(swap (language|bhasha)?|bhasha badlo|language badlo)/.test(t))
    return { action: 'swap' };
  const pair = t.match(/(hindi|marathi|english)\s*(to|se|⇄|<>)\s*(hindi|marathi|english)/);
  if (pair) {
    const code = (w: string): Lang => (w.startsWith('hin') ? 'hi' : w.startsWith('mar') ? 'mr' : 'en');
    const from = code(pair[1]), to = code(pair[3]);
    if (from !== to) {
      const found = PAIRS.find((p) => (p.a === from && p.b === to) || (p.a === to && p.b === from));
      if (found) return { action: 'pair', id: found.id };
    }
  }
  if (/(translator mode|translate mode|translation mode|translate karo|anuvad|bhashantar|dubhashiya)/.test(t))
    return { action: 'enter' };
  return null;
}

/** Strict prompt: output ONLY the translation, nothing else. */
export function translationPrompt(text: string, from: Lang, to: Lang): string {
  return (
    `Translate this ${LANG_NAMES[from]} line to ${LANG_NAMES[to]}. ` +
    `Output ONLY the translation — no quotes, no explanation, no extra words. ` +
    `Keep names/numbers as-is. Line: ${text}`
  );
}

/** System override for the translation brain call. */
export const TRANSLATE_SYSTEM =
  'You are a precise interpreter. Output ONLY the requested translation. ' +
  'Never add explanations, quotes, or commentary. Keep proper nouns unchanged.';

/** Offline phrasebook: exact + fuzzy matches for common lines. */
const PHRASES: { hi: RegExp; en: string; mr: string }[] = [
  { hi: /^(namaste|namaskar|hello|hi+|hey)\.?$/i, en: 'Hello!', mr: 'Namaskar!' },
  { hi: /^(shukriya|dhanyavad|thank ?you|thanks)\.?$/i, en: 'Thank you!', mr: 'Dhanyavad!' },
  { hi: /(yeh|ye|this).*(kitne|price|cost|rate|daam)/i, en: 'How much is this?', mr: 'He kiti la?' },
  { hi: /(bahut|bohot).*(mehnga|zyada)/i, en: 'That is too expensive.', mr: 'He khup mahag aahe.' },
  { hi: /(kam karo|sasta karo|discount|thoda kam)/i, en: 'Please reduce the price a little.', mr: 'Thode kami kara.' },
  { hi: /(kahan|kidhar|where).*(hospital|aspataal)/i, en: 'Where is the hospital?', mr: 'Hospital kuthe aahe?' },
  { hi: /(kahan|kidhar|where).*(station)/i, en: 'Where is the station?', mr: 'Station kuthe aahe?' },
  { hi: /(kahan|kidhar|where).*(toilet|bathroom|washroom|sauchalay)/i, en: 'Where is the washroom?', mr: 'Swachchhagruh kuthe aahe?' },
  { hi: /(madad|help).*(karo|chahiye|please)/i, en: 'Please help me.', mr: 'Krupaya mazi madat kara.' },
  { hi: /(paani|pani|water)/i, en: 'I need water.', mr: 'Mala pani pahije.' },
  { hi: /(khana|khaana|food|bhookh).*(kahan|chahiye)/i, en: 'Where can I get food?', mr: 'Jevan kuthe milel?' },
  { hi: /(samajh|samaj).*(nahi|na)/i, en: "I don't understand.", mr: 'Mala samjat nahi.' },
  { hi: /(dheere|slowly).*(bolo|speak)/i, en: 'Please speak slowly.', mr: 'Krupaya halu bola.' },
  { hi: /(mera naam|my name is)/i, en: 'My name is…', mr: 'Mazhe naav… aahe.' },
  { hi: /(kitne baje|time kya|what.*time)/i, en: 'What time is it?', mr: 'Kiti vajle?' },
];

export function offlineTranslate(text: string, from: Lang, to: Lang): string | null {
  if (from === to) return text;
  const t = String(text || '').trim();
  // Hindi/Hinglish -> English/Marathi
  if (from !== 'en') {
    for (const p of PHRASES) {
      if (p.hi.test(t)) return to === 'en' ? p.en : p.mr;
    }
  }
  // English -> Hindi/Marathi (reverse lookup)
  if (from === 'en') {
    const low = t.toLowerCase();
    for (const p of PHRASES) {
      if (low === p.en.toLowerCase().replace(/[!?.]$/, '') || low.includes(p.en.toLowerCase().replace(/[!?.]$/, '').slice(0, 12))) {
        return to === 'hi' ? hindiOf(p) : p.mr;
      }
    }
  }
  return null;
}

function hindiOf(p: { hi: RegExp; en: string }): string {
  const map: Record<string, string> = {
    'Hello!': 'Namaste!',
    'Thank you!': 'Shukriya!',
    'How much is this?': 'Yeh kitne ka hai?',
    'That is too expensive.': 'Yeh bahut mehnga hai.',
    'Please reduce the price a little.': 'Thoda kam kar dijiye.',
    'Where is the hospital?': 'Hospital kahan hai?',
    'Where is the station?': 'Station kahan hai?',
    'Where is the washroom?': 'Washroom kahan hai?',
    'Please help me.': 'Kripya meri madad karo.',
    'I need water.': 'Mujhe paani chahiye.',
    'Where can I get food?': 'Khana kahan milega?',
    "I don't understand.": 'Mujhe samajh nahi aaya.',
    'Please speak slowly.': 'Kripya dheere bolo.',
    'My name is…': 'Mera naam… hai.',
    'What time is it?': 'Kitne baje hain?',
  };
  return map[p.en] || p.en;
}
