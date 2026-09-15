// Shared spoken-number parser: English + Hindi/Hinglish number words.
// Used by fitness logging, email slot-fill, timers and money parsing.
// Pure + tested. Ambiguity note: "saath" (7) vs "sath" (60) — transcripts
// rarely distinguish them, so callers confirm ambiguous values in the UI
// and a "change last log to N" repair command always exists.

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
  // Hindi / Hinglish (common transliterations)
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5,
  che: 6, chhe: 6, chah: 6, saat: 7, saath: 7, aath: 8, ath: 8, nau: 9, no: 9,
  dus: 10, das: 10, gyarah: 11, gyara: 11, barah: 12, bara: 12, terah: 13,
  tera: 13, chaudah: 14, chodah: 14, pandrah: 15, pandra: 15, solah: 16,
  sola: 16, satrah: 17, satra: 17, atharah: 18, athra: 18, unnis: 19, unis: 19,
  bees: 20, bis: 20, ikkis: 21, bais: 22, teis: 23, chobbis: 24, pachees: 25,
  chabbis: 26, sattais: 27, atthais: 28, untis: 29, tees: 30, tis: 30,
  iktis: 31, battis: 32, tentis: 33, chauntis: 34, paintis: 35, chattis: 36,
  saintis: 37, arthtis: 38, untallis: 39, chalis: 40, challis: 40,
  iktalis: 41, bayalis: 42, tentalis: 43, chavalis: 44, paintalis: 45,
  chiyalis: 46, sadtalis: 47, adtalis: 48, unchas: 49, pachaas: 50,
  pachas: 50, ikyavan: 51, bavan: 52, tirpan: 53, chauvan: 54, pachpan: 55,
  chappan: 56, sattavan: 57, atthavan: 58, unsath: 59, sath: 60,
  iksath: 61, basath: 62, tresath: 63, chausath: 64, painsath: 65,
  chiyasath: 66, sadsath: 67, adsath: 68, unhattar: 69, sattar: 70,
  ikhattar: 71, bahattar: 72, tihattar: 73, chauhattar: 74, pachhattar: 75,
  chihattar: 76, sathattar: 77, athhattar: 78, unasi: 79, assi: 80,
  ikyasi: 81, byasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85, chiyasi: 86,
  sattasi: 87, atthasi: 88, navasi: 89, nabbe: 90, navve: 90,
  ikyanve: 91, banve: 92, tiranve: 93, chauranve: 94, pachanve: 95,
  chiyanve: 96, sattanve: 97, atthanve: 98, ninyanve: 99,
};

const SCALE: Record<string, number> = {
  hundred: 100, sau: 100, so: 100,
  thousand: 1000, hazar: 1000, hazaar: 1000,
  lakh: 100000, lac: 100000, lakhs: 100000,
  crore: 10000000, karod: 10000000, crores: 10000000, million: 1000000,
};

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Evaluate a run of number words ("do sau pachaas" -> 250). Null if none. */
export function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in SMALL) {
      current += SMALL[w];
      seen = true;
    } else if (w in SCALE) {
      const scale = SCALE[w];
      current = (current === 0 ? 1 : current) * scale;
      if (scale >= 1000) {
        total += current;
        current = 0;
      }
      seen = true;
    } else if (w === 'and') {
      continue;
    } else {
      return null;
    }
  }
  if (!seen) return null;
  return total + current;
}

export interface FoundNumber {
  value: number;
  /** Character offset where the match starts (digits) or -1 (words). */
  index: number;
  /** The matched raw text. */
  raw: string;
}

/**
 * Find the first spoken or written number in free text.
 * Digits win over words at the same position. Returns null when nothing
 * numeric is present. Fractions/decimals in digits ("2.5", "1,000") work.
 */
export function findNumber(text: string): FoundNumber | null {
  const t = String(text || '');
  const digit = t.match(/\d[\d,]*(?:\.\d+)?/);
  // Word scan: longest run of number-words.
  const tokens = tokenize(t);
  let best: { value: number; raw: string } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = Math.min(tokens.length, i + 6); j > i; j--) {
      const slice = tokens.slice(i, j);
      const v = wordsToNumber(slice);
      if (v !== null) {
        best = { value: v, raw: slice.join(' ') };
        i = j - 1;
        break;
      }
    }
    if (best && i >= tokens.length) break;
    if (best) break;
  }
  if (digit) {
    const raw = digit[0];
    const value = Number(raw.replace(/,/g, ''));
    if (Number.isFinite(value)) {
      // If a word-number appears strictly before the digit match, prefer it
      // only when the digit is clearly separate (e.g. "do pushups 20"? no —
      // first mention wins). Simple rule: earliest mention wins.
      if (best) {
        const wordIdx = t.toLowerCase().indexOf(best.raw.split(' ')[0]);
        const digitIdx = digit.index ?? 0;
        if (wordIdx >= 0 && wordIdx < digitIdx) {
          return { value: best.value, index: wordIdx, raw: best.raw };
        }
      }
      return { value, index: digit.index ?? 0, raw };
    }
  }
  if (best) {
    const wordIdx = t.toLowerCase().indexOf(best.raw.split(' ')[0]);
    return { value: best.value, index: wordIdx, raw: best.raw };
  }
  return null;
}

/** All numbers in order (for ranges like "30 sec on 10 off"). */
export function findAllNumbers(text: string): number[] {
  const out: number[] = [];
  const t = String(text || '');
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  const digitHits: { index: number; value: number }[] = [];
  while ((m = re.exec(t))) {
    const v = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(v)) digitHits.push({ index: m.index, value: v });
  }
  const tokens = tokenize(t);
  const wordHits: { index: number; value: number }[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let j = Math.min(tokens.length, i + 6); j > i; j--) {
      const v = wordsToNumber(tokens.slice(i, j));
      if (v !== null) {
        wordHits.push({ index: i, value: v });
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  // Interleave by approximate position: digit char index vs token index.
  // Good enough for short voice commands; callers use order, not offsets.
  const lower = t.toLowerCase();
  const positioned = [
    ...digitHits,
    ...wordHits.map((w) => ({ index: lower.indexOf(tokens[w.index] || ''), value: w.value })),
  ]
    .filter((h) => h.index >= 0)
    .sort((a, b) => a.index - b.index);
  // De-dupe overlaps (a digit inside a word run can't happen; keep all).
  for (const h of positioned) out.push(h.value);
  return out;
}
