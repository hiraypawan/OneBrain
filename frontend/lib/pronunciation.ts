import { levenshtein } from './fuzzy';

// Core pronunciation fix: the Web Speech engine returns ONE language's guess
// (en-IN / hi-IN / mr-IN) and only the top alternative. Indian proper nouns
// ("Vangani") routinely arrive truncated ("vani") or transliterated
// ("wangani"). This module recovers them with a phonetic gazetteer instead of
// trusting the raw transcript.
//
// Pure + unit-tested. It never invents an intent: correction only fires for
// tokens that are phonetically close to a KNOWN station/city, and the
// original wording is kept when nothing is clearly closer.

/** Collapse Indian-English spelling variation to one skeleton. */
export function phoneticKey(input: string): string {
  let s = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  if (!s) return '';
  // Aspirated digraphs -> unaspirated base (kh->k, gh->g, ...). Order matters.
  const pairs: Array<[RegExp, string]> = [
    [/chh/g, 'c'],
    [/ch/g, 'c'],
    [/sh/g, 's'],
    [/ph/g, 'f'],
    [/bh/g, 'b'],
    [/dh/g, 'd'],
    [/gh/g, 'g'],
    [/jh/g, 'j'],
    [/kh/g, 'k'],
    [/th/g, 't'],
    [/ng/g, 'n'],
    [/w/g, 'v'],
    [/z/g, 'j'],
    [/q/g, 'k'],
    [/x/g, 'ks'],
    [/ee/g, 'i'],
    [/oo/g, 'u'],
    [/aa/g, 'a'],
    [/au/g, 'o'],
    [/ou/g, 'u'],
  ];
  for (const [re, to] of pairs) s = s.replace(re, to);
  // Drop silent h left over from digraphs (e.g. "she" -> "se" handled above,
  // "dadar" keeps its h? no: remove non-initial h).
  s = s[0] + s.slice(1).replace(/h/g, '');
  // Collapse doubles (vall -> val, khopolli -> khopoli).
  s = s.replace(/([^ ])\1+/g, '$1');
  // Vowel-light skeleton: keep the first letter, drop the rest of aeiou.
  // "vangani" -> "vngn", "vani" -> "vn" (subsequence of vngn).
  const first = s[0];
  const rest = s.slice(1).replace(/[aeiou]/g, '');
  return (first + rest).slice(0, 8);
}

/** True when `short`'s skeleton is a subsequence of `long`'s skeleton. */
function isSubsequence(short: string, long: string): boolean {
  if (!short || !long || short.length < 2) return false;
  let i = 0;
  for (const ch of long) {
    if (ch === short[i]) i++;
    if (i >= short.length) return true;
  }
  return false;
}

export interface GazetteerEntry {
  canonical: string;
  /** Extra spellings callers may add; canonical is always matched too. */
  aliases?: string[];
}

// Suburban + key express hubs. Canonical names are lowercase single tokens
// or short phrases; matching is token/phrase based so "sandhurst road" works.
export const STATION_GAZETTEER: GazetteerEntry[] = [
  { canonical: 'vangani', aliases: ['vangni', 'wangani', 'vangaon'] },
  { canonical: 'shelu', aliases: ['shelu station', 'shelu'] },
  { canonical: 'badlapur' },
  { canonical: 'ambernath', aliases: ['ambarnath'] },
  { canonical: 'ulhasnagar', aliases: ['ulhas nagar'] },
  { canonical: 'karjat' },
  { canonical: 'khopoli' },
  { canonical: 'neral' },
  { canonical: 'bhivpuri', aliases: ['bhivpuri road'] },
  { canonical: 'palasdari' },
  { canonical: 'kelavli' },
  { canonical: 'dolavli' },
  { canonical: 'lowjee' },
  { canonical: 'titwala', aliases: ['titvala'] },
  { canonical: 'ambivli' },
  { canonical: 'shahad' },
  { canonical: 'vitthalwadi', aliases: ['vitthalvadi'] },
  { canonical: 'khadavli' },
  { canonical: 'vasind' },
  { canonical: 'asangaon', aliases: ['asangaon'] },
  { canonical: 'atgaon' },
  { canonical: 'thansit' },
  { canonical: 'khardi' },
  { canonical: 'umbermali' },
  { canonical: 'kasara', aliases: ['kasara'] },
  { canonical: 'kalyan' },
  { canonical: 'thakurli' },
  { canonical: 'dombivli', aliases: ['dombivali'] },
  { canonical: 'kopar' },
  { canonical: 'diva' },
  { canonical: 'mumbra' },
  { canonical: 'kalwa' },
  { canonical: 'thane' },
  { canonical: 'csmt', aliases: ['cstm', 'cst', 'vt', 'victoria terminus', 'chatrapati shivaji'] },
  { canonical: 'churchgate' },
  { canonical: 'andheri' },
  { canonical: 'borivali', aliases: ['borivali'] },
  { canonical: 'virar' },
  { canonical: 'vasai', aliases: ['vasai road'] },
  { canonical: 'nalasopara', aliases: ['nallasopara'] },
  { canonical: 'bhayandar', aliases: ['bhayander'] },
  { canonical: 'mira road', aliases: ['mira'] },
  { canonical: 'dahisar' },
  { canonical: 'kandivali', aliases: ['kandivali'] },
  { canonical: 'malad' },
  { canonical: 'goregaon', aliases: ['goregaon'] },
  { canonical: 'jogeshwari', aliases: ['jogeshvari'] },
  { canonical: 'vile parle', aliases: ['vileparle', 'parle'] },
  { canonical: 'santacruz', aliases: ['santa cruz'] },
  { canonical: 'khar' },
  { canonical: 'bandra' },
  { canonical: 'mahim' },
  { canonical: 'matunga road', aliases: ['matunga'] },
  { canonical: 'dadar' },
  { canonical: 'prabhadevi', aliases: ['elphinstone'] },
  { canonical: 'lower parel', aliases: ['lowerparel'] },
  { canonical: 'mahalaxmi', aliases: ['maha laxmi', 'mahalakshmi'] },
  { canonical: 'mumbai central' },
  { canonical: 'grant road' },
  { canonical: 'charni road', aliases: ['charn Road'] },
  { canonical: 'marine lines', aliases: ['marin lines'] },
  { canonical: 'ghatkopar', aliases: ['ghatkopar'] },
  { canonical: 'kurla' },
  { canonical: 'vidyavihar' },
  { canonical: 'mulund' },
  { canonical: 'nahur' },
  { canonical: 'bhandup' },
  { canonical: 'kanjurmarg' },
  { canonical: 'vikroli' },
  { canonical: 'kanjur' },
  { canonical: 'sion' },
  { canonical: 'panvel' },
  { canonical: 'khandeshwar' },
  { canonical: 'mansarovar' },
  { canonical: 'kharghar' },
  { canonical: 'belapur', aliases: ['cbd belapur'] },
  { canonical: 'seawoods' },
  { canonical: 'nerul' },
  { canonical: 'juinagar' },
  { canonical: 'sanpada' },
  { canonical: 'vashi' },
  { canonical: 'mankhurd' },
  { canonical: 'govandi' },
  { canonical: 'chembur' },
  { canonical: 'tilak nagar', aliases: ['tilaknagar'] },
  { canonical: 'wadala', aliases: ['vadala'] },
  { canonical: 'sewri', aliases: ['sewree'] },
  { canonical: 'dahanu', aliases: ['dahanu road'] },
  { canonical: 'vangaon' },
  { canonical: 'boisar' },
  { canonical: 'palghar' },
  // Pune suburban
  { canonical: 'pune' },
  { canonical: 'shivajinagar' },
  { canonical: 'khadki' },
  { canonical: 'pimpri' },
  { canonical: 'chinchwad' },
  { canonical: 'akurdi' },
  { canonical: 'dehu road' },
  { canonical: 'talegaon' },
  { canonical: 'lonavala', aliases: ['lonavla'] },
  // World cities already in CITY_TRANSIT (so flight/metro names correct too)
  { canonical: 'mumbai', aliases: ['bombay'] },
  { canonical: 'delhi', aliases: ['new delhi'] },
  { canonical: 'bengaluru', aliases: ['bangalore'] },
  { canonical: 'chennai', aliases: ['madras'] },
  { canonical: 'hyderabad' },
  { canonical: 'kolkata', aliases: ['calcutta'] },
  { canonical: 'london' },
  { canonical: 'dubai' },
  { canonical: 'singapore' },
];

const STOPWORDS = new Set([
  'from', 'to', 'se', 'tak', 'till', 'upto', 'aur', 'and', 'the', 'station',
  'timetable', 'time', 'table', 'schedule', 'timings', 'local', 'train',
  'metro', 'platform', 'trak', 'track', 'status', 'live', 'batao', 'bata',
  'dikhao', 'please', 'today', 'kal', 'tomorrow', 'via',
]);

// Route-syntax words are never part of a station name in the gazetteer.
// A bigram containing one ("pune to", "from thane") must not be resolved as
// a whole — it once ate the preposition ("pune to" -> "pune") and broke
// from/to parsing downstream.
const PREPWORDS = new Set(['from', 'to', 'se', 'tak', 'till', 'upto', 'and', 'aur']);

// Correction of short tokens ("vani" -> "vangani") is only safe with transit
// context — without it "call vani now" (a person's name) would be rewritten
// to a station. Long typo-level matches are safe anywhere.
const TRANSIT_ANCHORS =
  /\b(stations?|locals?|trains?|metros?|platforms?|timetables?|schedules?|timings?|from|se|tak|till|upto|pnr|flights?|express|fast|slow|line)\b/i;

function tokensOf(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Resolve one heard token/phrase to a canonical station when it is clearly
 * close. Returns null instead of guessing.
 */
export function resolveStationName(heard: string): string | null {
  const norm = String(heard || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!norm || norm.length < 3) return null;
  const heardKey = phoneticKey(norm);
  if (!heardKey) return null;
  let best: { canonical: string; score: number } | null = null;
  for (const entry of STATION_GAZETTEER) {
    const names = [entry.canonical, ...(entry.aliases || [])];
    for (const name of names) {
      const nameNorm = name.toLowerCase();
      if (nameNorm === norm) return entry.canonical;
      const nameKey = phoneticKey(nameNorm);
      if (!nameKey) continue;
      // Exact skeleton match (transliteration variants like
      // "wangani"/"vangani"). Short skeletons are untrustworthy: "what"
      // collapses to "vt", the Victoria Terminus code — so skeletons under
      // 3 chars never match by sound alone.
      if (nameKey === heardKey) {
        if (heardKey.length >= 3 && norm.length >= 4) return entry.canonical;
        continue;
      }
      const maxLen = Math.max(norm.length, nameNorm.length);
      const dist = levenshtein(norm, nameNorm, 3);
      // Truncation ("vani" for "vangani"): short skeleton subsequence of the
      // station skeleton + small edit distance on the shared prefix.
      const sub =
        isSubsequence(heardKey, nameKey) || isSubsequence(nameKey, heardKey);
      const prefix = norm.slice(0, Math.min(3, norm.length));
      const sharesPrefix =
        nameNorm.startsWith(prefix) || norm.startsWith(nameNorm.slice(0, 3));
      if (sub && sharesPrefix && norm.length >= 4 && dist <= 3) {
        const score = 1 - dist / Math.max(maxLen, 1);
        if (!best || score > best.score) best = { canonical: entry.canonical, score };
        continue;
      }
      // Ordinary typo ("andheri" heard as "andhari"). Short fragments
      // ("wet" vs the "vt" code, distance 1) never fuzzy-match — exact
      // codes already returned above.
      if (norm.length >= 4 && dist <= (norm.length <= 5 ? 1 : 2)) {
        const score = 1 - dist / maxLen;
        if (!best || score > best.score) best = { canonical: entry.canonical, score };
      }
    }
  }
  // Conservative: only correct when clearly close.
  if (best && best.score >= 0.55) return best.canonical;
  return null;
}

export interface Correction {
  from: string;
  to: string;
}

/**
 * Correct station/city names inside a transcript. Scans unigrams + bigrams
 * (for "mumbai central", "tilak nagar") and replaces only confident matches.
 * Stopwords and short fillers are never touched.
 */
export function correctProperNouns(
  text: string,
  opts?: { force?: boolean },
): { text: string; corrections: Correction[] } {
  const original = String(text || '');
  if (!original.trim()) return { text: original, corrections: [] };
  const corrections: Correction[] = [];
  // `force` ignores the transit-anchor gate. Used only to PROPOSE a
  // "did you mean…?" question, never to silently rewrite — so a bare
  // "vani" can still surface "Vangani" instead of dying unheard.
  const hasAnchor = opts?.force === true || TRANSIT_ANCHORS.test(original);
  // Bigrams first so "tilak nagar" wins over "tilak" alone.
  let out = ` ${original} `;
  const words = tokensOf(original);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i + 1 < words.length) candidates.push(`${words[i]} ${words[i + 1]}`);
    candidates.push(words[i]);
  }
  // Longest first.
  candidates.sort((a, b) => b.length - a.length);
  for (const cand of candidates) {
    if (seen.has(cand)) continue;
    seen.add(cand);
    const parts = cand.split(' ');
    if (parts.every((p) => STOPWORDS.has(p))) continue;
    // Never resolve route syntax as a station ("pune to" must keep its "to").
    if (parts.length > 1 && parts.some((p) => PREPWORDS.has(p))) continue;
    const compactLen = cand.replace(/ /g, '').length;
    if (compactLen < 4) continue;
    // Short ambiguous tokens need transit context ("vani" the person vs
    // "vani station"). Long tokens correct anywhere.
    if (!hasAnchor && compactLen <= 5) continue;
    // Don't "correct" something already canonical.
    const already = STATION_GAZETTEER.some(
      (e) => e.canonical === cand || (e.aliases || []).includes(cand),
    );
    if (already) continue;
    const resolved = resolveStationName(cand);
    if (!resolved || resolved === cand) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    if (re.test(out)) {
      out = out.replace(re, (_m, prefix) => `${prefix}${resolved}`);
      corrections.push({ from: cand, to: resolved });
    }
  }
  return { text: out.trim().replace(/\s+/g, ' '), corrections };
}

/**
 * Pick the best transcript from Web Speech n-best alternatives. Scores each
 * alternative by gazetteer hits first (a proper noun surviving matters more
 * than engine confidence), then by length as a tiebreak.
 */
export function pickBestAlternative(alternatives: string[]): string {
  const list = (alternatives || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  let best = list[0];
  let bestScore = -1;
  for (const alt of list) {
    const words = tokensOf(alt).filter((w) => !STOPWORDS.has(w) && w.length >= 4);
    let hits = 0;
    for (const w of words) {
      if (resolveStationName(w)) hits += 2;
      else if (STATION_GAZETTEER.some((e) => e.canonical === w)) hits += 2;
    }
    const score = hits * 10 + Math.min(alt.length, 120) / 120;
    if (score > bestScore) {
      bestScore = score;
      best = alt;
    }
  }
  return best;
}

/**
 * Propose a station correction as a QUESTION, not a rewrite. Returns null
 * unless a forced re-read finds a gazetteer station the silent path missed
 * (no transit anchors, e.g. a bare "vani"). Callers must confirm with the
 * user before running anything — a wrong guess costs more than a shrug.
 * Pure; the length/word caps keep long conversation out of this path.
 */
export function suggestStationCorrection(text: string): { corrected: string; station: string } | null {
  const original = String(text || '').trim();
  if (!original || original.length > 120) return null;
  if (tokensOf(original).length > 10) return null;
  const forced = correctProperNouns(original, { force: true });
  if (!forced.corrections.length || forced.text === original) return null;
  for (const c of forced.corrections) {
    const station = c.to;
    const known = STATION_GAZETTEER.some(
      (e) => e.canonical === station || (e.aliases || []).includes(station),
    );
    if (known) return { corrected: forced.text, station };
  }
  return null;
}

/** JSGF grammar for SpeechGrammarList biasing (Chrome-only; ignored elsewhere). */
export function stationGrammar(): string {
  const names = STATION_GAZETTEER.map((e) => e.canonical).join(' | ');
  return `#JSGF V1.0; grammar stations; public <station> = ${names};`;
}
