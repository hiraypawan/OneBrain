// Transliterate Indic scripts to Roman letters (Hinglish style) so the AI,
// which is far stronger in Latin script, understands clearly — and the chat
// shows one consistent script. Pure ASCII source: all code points as escapes.
//
// Scope: Hindi/Marathi Devanagari. Schwa handling is the common-sense subset
// (drop word-final inherent 'a'); medial schwas stay — "namaste" reads right,
// rare words may carry an extra 'a'. Good enough for voice chat, not for poetry.
const VOWEL: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah',
};

const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy',
  'ड़': 'r', 'ढ़': 'rh',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'झ़': 'zh',
  'फ़': 'f', 'य़': 'y', 'ळ': 'l', 'ऱ': 'r',
};

const MATRA: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  'ं': 'n', 'ँ': 'n', 'ः': 'h', 'ृ': 'ri', 'ॅ': 'e', 'ॉ': 'o',
};

const VIRAMA = '्';
const NUKTA = '़';

function isDevanagari(ch: string): boolean {
  const cp = ch.codePointAt(0) || 0;
  return cp >= 0x0900 && cp <= 0x097f;
}

export function hasDevanagari(text: string): boolean {
  for (const ch of text || '') if (isDevanagari(ch)) return true;
  return false;
}

// Frequent English words as the Hindi recognizer actually hears them,
// mapped back to proper English so the AI (and you) read clean text.
const WORD_FIX: Record<string, string> = {
  taim: 'time', taaim: 'time', vhaat: 'what', vot: 'what',
  pulis: 'police', steshan: 'station', istheshan: 'station',
  tikat: 'ticket', phon: 'phone', fon: 'phone', mobail: 'mobile',
  aaphis: 'office', ophs: 'office', iskul: 'school', skool: 'school',
  aspataal: 'hospital', haspital: 'hospital', doktr: 'doctor',
  relve: 'railway', tren: 'train', bas: 'bus', kaar: 'car',
  paisa: 'money', capaay: 'tea', khaana: 'food', pani: 'water',
  el: 'L', em: 'M', en: 'N', bi: 'B', di: 'D',
  helo: 'hello', namaste: 'namaste', dhanyavaad: 'thanks',
  samay: 'time', taareekh: 'date', aaj: 'today', kal: 'tomorrow',
  haan: 'yes', nahin: 'no', nahim: 'no',
  kyaa: 'kya', khaan: 'kahan', kahaan: 'kahan', yhaan: 'yahan', vhaan: 'wahan',
  ij: 'is', d: 'the', aur: 'and', par: 'on', se: 'from',
};

export function transliterateWord(word: string): string {
  let out = '';
  const chars = [...word];
  let i = 0;
  let pendingA = false; // consonant waiting on its inherent 'a'
  const flushA = () => {
    if (pendingA) {
      out += 'a';
      pendingA = false;
    }
  };
  while (i < chars.length) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (VOWEL[ch] !== undefined) {
      flushA();
      out += VOWEL[ch];
      i++;
    } else if (CONS[ch] !== undefined) {
      flushA();
      out += CONS[ch];
      pendingA = true;
      i++;
    } else if (ch === VIRAMA) {
      pendingA = false; // join with next consonant, no vowel
      i++;
    } else if (ch === NUKTA) {
      i++; // already handled via precomposed nukta consonants
    } else if (MATRA[ch] !== undefined) {
      pendingA = false; // matra replaces the inherent 'a'
      // Diphthong fix: aa + i/ee reads as "ai" (as in "taim").
      if ((ch === 'ि' || ch === 'ी') && out.endsWith('aa') && next && isDevanagari(next)) {
        out = out.slice(0, -2) + 'ai';
      } else {
        out += MATRA[ch];
      }
      i++;
    } else if (ch >= '०' && ch <= '९') {
      flushA();
      out += String(ch.charCodeAt(0) - '०'.charCodeAt(0));
      i++;
    } else {
      flushA();
      out += ch;
      i++;
    }
  }
  // Word-final inherent 'a' (Hindi schwa) is simply never flushed:
  // kamal, not kamala. Nothing to do — pendingA dies here.
  return out;
}

export function transliterate(text: string): string {
  return String(text || '')
    .split(/(\s+)/)
    .map((tok) => (/^\s+$/.test(tok) ? tok : hasDevanagari(tok) ? transliterateWord(tok) : tok))
    .join('');
}

export function normalizeHinglish(text: string): string {
  const roman = transliterate(text);
  return roman
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      const fixed = WORD_FIX[lower];
      if (!fixed) return tok;
      // preserve leading capital
      return /^[A-Z]/.test(tok) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
    })
    .join('');
}
