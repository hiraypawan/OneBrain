// Live translator mode: continuous speech -> translated speech.
// Pair selection + strict translation prompts + offline phrasebook for the
// most common travel/market lines. AI does open translation when online.

import { detectLatinLanguage, latinScores, scriptLanguage } from '../locale/text-language';
import type { ReplyLanguage } from '../locale/voice-languages';

export type Lang = 'en' | 'hi' | 'mr' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'ja' | 'ko' | 'zh' | 'ar';

export interface LangPair {
  id: string;
  a: Lang;
  b: Lang;
  label: string;
}

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English', hi: 'Hindi', mr: 'Marathi', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic',
};

/** Voice for speaking each language (English uses the user's own accent instead). */
export const LANG_TTS: Record<Lang, string> = {
  en: 'en-US', hi: 'hi-IN', mr: 'mr-IN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT',
  pt: 'pt-BR', nl: 'nl-NL', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ar: 'ar-SA',
};

const WORLD: Lang[] = ['es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh', 'ar'];

export const PAIRS: LangPair[] = [
  { id: 'hi-en', a: 'hi', b: 'en', label: 'Hindi ⇄ English' },
  { id: 'mr-en', a: 'mr', b: 'en', label: 'Marathi ⇄ English' },
  { id: 'hi-mr', a: 'hi', b: 'mr', label: 'Hindi ⇄ Marathi' },
  ...WORLD.map((l): LangPair => ({ id: `en-${l}`, a: 'en', b: l, label: `English ⇄ ${LANG_NAMES[l]}` })),
];

export function pairById(id: string): LangPair {
  return PAIRS.find((p) => p.id === id) || PAIRS[0];
}

/** The pair containing both languages, if there is one. */
export function pairFor(x: Lang, y: Lang): LangPair | undefined {
  return x === y ? undefined : PAIRS.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
}

const REPLY_TO_LANG: Partial<Record<ReplyLanguage, Lang>> = {
  hindi: 'hi', hinglish: 'hi', marathi: 'mr', spanish: 'es', french: 'fr', german: 'de', italian: 'it',
  portuguese: 'pt', dutch: 'nl', japanese: 'ja', korean: 'ko', chinese: 'zh', arabic: 'ar',
};

/**
 * Which pair "translator mode" opens with: the user's own language and
 * English; Hindi ⇄ English in India; otherwise English ⇄ Spanish, the most
 * asked-for pair (say "English to French" to change).
 */
export function defaultPairId(voiceReply: ReplyLanguage, indian: boolean): string {
  const own = REPLY_TO_LANG[voiceReply];
  const pair = own ? pairFor(own, 'en') : undefined;
  if (pair) return pair.id;
  return indian ? 'hi-en' : 'en-es';
}

const LATIN_NAME: Partial<Record<Lang, string>> = {
  en: 'english', es: 'spanish', fr: 'french', de: 'german', it: 'italian', pt: 'portuguese', nl: 'dutch',
};

const SCRIPT_LANG: Record<string, Lang> = { japanese: 'ja', korean: 'ko', chinese: 'zh', arabic: 'ar' };

/** The language of a line; unknown Latin-script text counts as English. */
export function detectLang(text: string): Lang {
  return detectKnownLang(text) ?? 'en';
}

/** The language of a line when there is real evidence for it; null when unsure. */
function detectKnownLang(text: string): Lang | null {
  const t = String(text || '');
  const script = scriptLanguage(t);
  if (script) return SCRIPT_LANG[script];
  if (/[\u0900-\u097F]/.test(t)) {
    // Marathi markers in Devanagari.
    if (/(aahe|ahet|nahi ka|kasa|kashi|kuthe|mala|tumhala|aapan)/i.test(t)) return 'mr';
    return 'hi';
  }
  // Roman Marathi markers (checked before Hinglish: distinct verb/noun forms).
  if (/\b(aahe|ahet|aahes|aahet|aahot|kuthe|kuthun|kutha|kasa|kashi|kase|kiti|tula|tumhala|mala|mazha|maza|mazi|tujha|tujhi|kay challay|barobar|nako|pahije|hota|hoti|zala|zali)\b/i.test(t)) return 'mr';
  // Roman Hinglish markers — the translator's main real-world input.
  if (/\b(yeh|hai|hain|kya|kaise|kitne|kitna|kitni|kahan|kidhar|kaun|kisne|mera|mere|meri|humara|mujhe|mujhko|tumhe|tumhara|tumhari|aapko|nahi|nahin|matlab|wala|wali|bahut|bohot|thoda|zyada|achha|acha|theek|sahi|galat|batao|dikhao|suno|dekho|karo|chahiye|padega|sakta|sakti|raha|rahi|rahe|gaya|gayi|kiya|liya|diya|namaste|namaskar|shukriya|dhanyavad|madad|paani|khana|bhookh|samajh|dheere|sasta|mehnga)\b/i.test(t)) return 'hi';
  const latin = detectLatinLanguage(t);
  return (Object.keys(LATIN_NAME) as Lang[]).find((l) => LATIN_NAME[l] === latin) ?? null;
}

/**
 * Which side of the active pair a line is in. Beyond detectLang this also
 * settles short Latin-script lines ("gracias", "merci beaucoup") by counting
 * each side's common words.
 */
export function detectLangInPair(text: string, pair: LangPair): Lang {
  const known = detectKnownLang(text);
  if (known === pair.a || known === pair.b) return known;
  const scores = latinScores(text) as unknown as Record<string, number>;
  const score = (l: Lang) => scores[LATIN_NAME[l] ?? ''] ?? 0;
  const a = score(pair.a), b = score(pair.b);
  if (a !== b) return a > b ? pair.a : pair.b;
  // No evidence either way: unknown Latin text is English when English is a side.
  return pair.a === 'en' || pair.b === 'en' ? 'en' : pair.a;
}

export type TranslatorIntent =
  | { action: 'enter' }
  | { action: 'exit' }
  | { action: 'swap' }
  | { action: 'pair'; id: string }
  | null;

const LANG_WORDS: Array<[RegExp, Lang]> = [
  [/^hindi/, 'hi'], [/^marathi/, 'mr'], [/^english/, 'en'], [/^(spanish|espa[nñ]ol)/, 'es'],
  [/^(french|fran[cç]ais)/, 'fr'], [/^(german|deutsch)/, 'de'], [/^italian/, 'it'], [/^portuguese/, 'pt'],
  [/^dutch/, 'nl'], [/^japanese/, 'ja'], [/^korean/, 'ko'], [/^(chinese|mandarin)/, 'zh'], [/^arabic/, 'ar'],
];
const LANG_WORD = 'hindi|marathi|english|spanish|español|espanol|french|français|francais|german|deutsch|italian|portuguese|dutch|japanese|korean|chinese|mandarin|arabic';
const PAIR_RE = new RegExp(`(${LANG_WORD})\\s*(?:to|se|⇄|<>|and)\\s*(${LANG_WORD})`);
const SINGLE_RE = new RegExp(`^(?:translat\\w*\\s+(?:to|into)\\s+(${LANG_WORD})|(${LANG_WORD})\\s+(?:translator|translation|interpreter)(?:\\s+mode)?)$`);

function langOfWord(word: string): Lang {
  return LANG_WORDS.find(([re]) => re.test(word))?.[1] ?? 'en';
}

export function detectTranslatorIntent(text: string): TranslatorIntent {
  const t = String(text || '').toLowerCase().trim();
  if (/^(translator (mode )?(band|off|stop|exit)|translation band|stop translating|bas translation)/.test(t))
    return { action: 'exit' };
  if (/^(swap (language|bhasha)?|bhasha badlo|language badlo)/.test(t))
    return { action: 'swap' };
  // "english to spanish", "hindi se marathi"
  const pair = t.match(PAIR_RE);
  if (pair) {
    const found = pairFor(langOfWord(pair[1]), langOfWord(pair[2]));
    if (found) return { action: 'pair', id: found.id };
  }
  // "translate to french", "spanish translator": that language with English.
  const single = t.match(SINGLE_RE);
  if (single) {
    const found = pairFor(langOfWord(single[1] || single[2]), 'en');
    if (found) return { action: 'pair', id: found.id };
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
  // The phrasebook covers Hindi, Marathi and English only; the AI does the rest.
  const covered = (l: Lang) => l === 'en' || l === 'hi' || l === 'mr';
  if (!covered(from) || !covered(to)) return null;
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
