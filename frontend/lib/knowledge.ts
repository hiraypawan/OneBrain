// Keyless factual layer: Wikipedia (no key, CORS-open, fresh data).
// Used for short factual questions BEFORE burning AI quota — and it fixes
// the "AI hedges on current events" class (contestants, winners, capitals).
export interface WikiAnswer {
  title: string;
  text: string;
  url: string;
}

const FACTUAL_START =
  /^(who|what|when|where|which|whom|whose|list|name|tell me about|about|kaun|kya|kab|kahan|kitne|kisne|current|latest|top\s+\d|aaj|abhi)\b/i;
const FACTUAL_WORDS =
  /contestants?|winner|capital|population|president|prime minister|chief minister|score|match|movie|actor|actress|release date|season|episode|song|meaning of/i;

export function looksFactual(message: string): boolean {
  const t = String(message || '').trim();
  if (!t || t.length > 220) return false;
  return FACTUAL_START.test(t) || FACTUAL_WORDS.test(t);
}

// Trim to whole sentences so speech never cuts mid-thought.
export function cleanWikiText(text: string, maxChars = 600): string {
  const t = String(text || '').replace(/\[.+?\]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastDot = cut.lastIndexOf('. ');
  return (lastDot > 200 ? cut.slice(0, lastDot + 1) : `${cut}…`).trim();
}

export async function fetchWikipedia(message: string): Promise<WikiAnswer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    const api = 'https://en.wikipedia.org/w/api.php';
    const s = await fetch(
      `${api}?action=query&list=search&srsearch=${encodeURIComponent(message)}&srlimit=3&format=json&origin=*`,
      { signal: ctrl.signal }
    );
    if (!s.ok) {
      clearTimeout(timer);
      return null;
    }
    const sj = await s.json();
    const hit = sj?.query?.search?.[0];
    if (!hit?.title) {
      clearTimeout(timer);
      return null;
    }
    const e = await fetch(
      `${api}?action=query&prop=extracts&exintro&explaintext&exsentences=3&titles=${encodeURIComponent(hit.title)}&format=json&origin=*`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!e.ok) return null;
    const ej = await e.json();
    const pages = ej?.query?.pages || {};
    const page: any = Object.values(pages)[0];
    const text = cleanWikiText(page?.extract || '');
    if (!text || text.length < 40) return null;
    return {
      title: String(hit.title),
      text,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(hit.title).replace(/ /g, '_'))}`,
    };
  } catch {
    return null;
  }
}
