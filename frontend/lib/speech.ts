// Scrub chat text into speakable sentences: no emojis, no markdown,
// no URLs - speech engines read every character literally.
export function cleanForSpeech(input: string): string {
  let t = input || '';

  // Fenced code blocks: keep inner text, drop fences
  t = t.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '));
  // Inline code
  t = t.replace(/`([^`]*)`/g, '$1');
  // Images ![alt](url) -> alt ; links [text](url) -> text
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Bare URLs are useless aloud
  t = t.replace(/https?:\/\/[^\s)]+/g, ' ');
  // Headings, quotes, list markers, table pipes, rules
  t = t.replace(/^#{1,6}\s*/gm, '');
  t = t.replace(/^>\s?/gm, '');
  t = t.replace(/^\s*([-*+]|\d+[.)])\s+/gm, '');
  t = t.replace(/\|/g, ' ');
  t = t.replace(/^(\*\*\*|---|___)\s*$/gm, ' ');
  // Bold / italic / strikethrough: keep words, drop markers
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2');
  t = t.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1$2');
  t = t.replace(/~~(.*?)~~/g, '$1');
  // Any leftover markdown characters
  t = t.replace(/[*_~#`]/g, '');
  // Emojis/symbols: filtered by code point (no fragile giant regex).
  // Covers misc symbols, dingbats, arrows, shapes, emoticons, pictographs.
  t = stripEmoji(t);
  // Abbreviations spoken naturally
  t = t.replace(/\be\.g\./gi, 'for example');
  t = t.replace(/\bi\.e\./gi, 'that is');
  t = t.replace(/\betc\./gi, 'etcetera');
  t = t.replace(/\bvs\./gi, 'versus');
  // Line breaks become pauses
  t = t.replace(/\s*\n+\s*/g, '. ');
  // Tidy spaces and repeated punctuation
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/([?!.,:;])\1+/g, '$1');
  t = t.replace(/\s+([?!.,:;])/g, '$1');
  return t.trim();
}

// Split a bilingual reply: spoken part in the user language, plus an
// optional short English version after a ---EN--- line.
export function splitReply(answer: string): { spoken: string; english: string | null } {
  const idx = (answer || '').indexOf('---EN---');
  if (idx === -1) return { spoken: (answer || '').trim(), english: null };
  const spoken = answer.slice(0, idx).trim();
  const english = answer.slice(idx + '---EN---'.length).trim();
  if (!english) return { spoken: spoken || answer.trim(), english: null };
  return { spoken: spoken || english, english };
}

// Pick a TTS voice locale matching the reply's script, so Marathi answers
// don't come out in an English voice (and vice versa).
export function ttsLangFor(text: string, preferred: string): string {
  const t = text || '';
  if (/[\u0900-\u097F]/.test(t)) return preferred === 'marathi' ? 'mr-IN' : 'hi-IN';
  if (/[\u0A00-\u0A7F]/.test(t)) return 'pa-IN';
  if (/[\u0A80-\u0AFF]/.test(t)) return 'gu-IN';
  if (/[\u0980-\u09FF]/.test(t)) return 'bn-IN';
  if (/[\u0B00-\u0B7F]/.test(t)) return 'or-IN';
  if (/[\u0B80-\u0BFF]/.test(t)) return 'ta-IN';
  if (/[\u0C00-\u0C7F]/.test(t)) return 'te-IN';
  if (/[\u0C80-\u0CFF]/.test(t)) return 'kn-IN';
  if (/[\u0D00-\u0D7F]/.test(t)) return 'ml-IN';
  if (/[\u0600-\u06FF]/.test(t)) return 'ar-SA';
  if (/[\u4E00-\u9FFF]/.test(t)) return 'zh-CN';
  if (/[\u3040-\u30FF]/.test(t)) return 'ja-JP';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko-KR';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru-RU';
  return preferred === 'hi-IN' ? 'hi-IN' : 'en-IN';
}

// Code points to drop: [start, end] pairs as hex numbers (no giant regex).
const DROP_RANGES: Array<[number, number]> = [
  [0x2600, 0x27bf], // misc symbols, dingbats, arrows supplement
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0xfe00, 0xfe0f], // variation selectors
  [0x1f000, 0x1faff], // emoticons, pictographs, symbols, flags
  [0x2190, 0x21ff], // arrows
  [0x2300, 0x23ff], // misc technical
  [0x25a0, 0x25ff], // geometric shapes
  [0x200d, 0x200d], // zero-width joiner
];

function stripEmoji(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    let drop = false;
    for (const [a, b] of DROP_RANGES) {
      if (cp >= a && cp <= b) {
        drop = true;
        break;
      }
    }
    if (!drop) out += ch;
  }
  return out;
}
