// Research briefings: "EV scooters under 1.5L research karo" -> spoken
// 60-second summary + structured card (picks, specs, source links, saved to
// memory). Grounding: Wikipedia lookups for entities + AI synthesis that
// must cite only fetched sources. Offline or source-less -> honest message,
// never invented specs/prices.

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchBrief {
  query: string;
  spoken: string;
  picks: { name: string; detail: string }[];
  bullets: string[];
  sources: ResearchSource[];
  asOf: string;
  grounded: boolean;
}

export function detectResearchIntent(text: string): string | null {
  const t = String(text || '').trim();
  // Prefix form: "research: best phones under 20000" -> query AFTER the verb.
  const pre = t.match(/^(research karo|compare karo|find options for|best .* under|top \d+ .* (?:under|below)|research|compare|dhoondho|khoj)\b[:\s]*(.+)?/i);
  if (pre && pre[2] && pre[2].trim().length >= 3) return cleanupQuery(pre[2].trim());
  // Suffix form: "EV scooters under 1.5L research karo" -> query BEFORE the verb.
  const suf = t.match(/^(.+?)\s+(research karo|par research|ki research|compare karo|ka comparison|research)\.?$/i);
  if (suf && suf[1].trim().length >= 3) return cleanupQuery(suf[1].trim());
  // "EV scooters under 1.5L batao" style: topic + under/below + research-ish verb
  const m2 = t.match(/(under|below|comparison|vs|best|top \d+|kaunsa (le|best)|review)/i);
  if (m2 && t.length > 15 && t.length < 200 && /(batao|dikhao|suggest|recommend|options|kaunsa|kya)/i.test(t)) {
    return cleanupQuery(t);
  }
  return null;
}

function cleanupQuery(q: string): string {
  return q
    .replace(/^(please\s+)?(research karo|research|compare karo|compare|dhoondho|khoj)\s*/i, '')
    .replace(/\s*(research karo|par research|ki research|compare karo|ka comparison|research)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Split a query into 1-3 Wikipedia-searchable entity phrases. */
export function planEntitySearches(query: string): string[] {
  const q = String(query || '');
  const parts = q
    .split(/\s+vs\.?\s+|\s+or\s+|\s+aur\s+|,/i)
    .map((s) => s.replace(/(under|below|above)\s+[\d.,]+\s*(l|lakh|k|thousand|rs|inr|₹|\$)?/gi, '')
      .replace(/(best|top\s*\d+|batao|dikhao|suggest|kaunsa|review|comparison|compare)/gi, '')
      .replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 3);
  return [...new Set(parts)].slice(0, 3);
}

export const RESEARCH_SYSTEM =
  'You turn fetched source snippets into a tight spoken research brief. ' +
  'RULES: Use ONLY facts present in the provided sources. Never invent prices, specs, dates, or availability. ' +
  'If sources lack prices/specs, say "price not verified in my sources". ' +
  'Output format, exactly:\nLINE1: spoken summary, 2-3 sentences, under 60 seconds to say.\n' +
  'Then "PICKS:" followed by up to 3 lines "name — one-line detail".\n' +
  'Then "NOTES:" followed by up to 4 short bullets (limits, what to verify before buying).';

/** Parse the AI synthesis into the structured brief shape. */
export function parseSynthesis(query: string, text: string, sources: ResearchSource[], asOf: string): ResearchBrief {
  const t = String(text || '');
  const spokenM = t.split(/PICKS:/i)[0].trim();
  const picksM = (t.split(/PICKS:/i)[1] || '').split(/NOTES:/i)[0] || '';
  const notesM = t.split(/NOTES:/i)[1] || '';
  const picks = picksM.split('\n').map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 3)
    .map((line) => {
      const [name, ...rest] = line.split(/—|-|:/);
      return { name: (name || line).trim().slice(0, 60), detail: (rest.join(' ').trim() || line).slice(0, 160) };
    });
  const bullets = notesM.split('\n').map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 4);
  return {
    query,
    spoken: spokenM.slice(0, 600) || 'Research ready — details are on screen.',
    picks,
    bullets,
    sources,
    asOf,
    grounded: sources.length > 0,
  };
}

/** Offline/no-source brief: honest, still useful (what to check). */
export function ungroundedBrief(query: string): ResearchBrief {
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    query,
    spoken: `Maine ${query} ke liye live sources nahi nikaal paye — isliye main keemat ya specs nahi bataunga, warna galat ho sakta hai. Screen par checklist hai; internet par dobara poochna, main poora brief bana dunga.`,
    picks: [],
    bullets: [
      'Compare ex-showroom vs on-road price — difference bada hota hai.',
      'Range/claims: company figure nahi, real-user reviews dekho.',
      'Service network apne sheher mein check karo.',
      'Warranty + battery replacement cost zaroor poochho.',
    ],
    sources: [],
    asOf,
    grounded: false,
  };
}
